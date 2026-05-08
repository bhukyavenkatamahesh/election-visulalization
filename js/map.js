class MapView {
    constructor(containerId) {
        this.container = d3.select(containerId);
        const rect = this.container.node().getBoundingClientRect();
        // Guard against 0-size panels (flexbox not yet resolved): fall back to
        // a reasonable default so fitSize doesn't collapse India to a point.
        this.width = rect.width > 50 ? rect.width : 600;
        this.height = rect.height > 50 ? rect.height : 600;

        this.svg = this.container.append('svg')
            .attr('viewBox', `0 0 ${this.width} ${this.height}`)
            .attr('preserveAspectRatio', 'xMidYMid meet')
            .style('background', 'var(--panel-bg)')
            .style('display', 'block');

        // Explicit panel-colored background rect so the SVG can't inherit a
        // stray fill from global CSS or browser extensions.
        this.svg.append('rect')
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('fill', '#161b22');

        // Map Data (needed before fitSize)
        this.geoData = state.geoData;

        // Clean degenerate micro-polygon rings that cause D3 rendering bugs.
        // Bharatpur (and possibly others) have hundreds of near-zero-area rings
        // (4-5 nearly identical points) that D3's geoPath renders as a massive
        // bounding-box square, squishing the rest of India into a tiny dot.
        // We use the Shoelace formula to compute approximate polygon area and
        // drop anything with negligible area.
        function ringArea(ring) {
            let area = 0;
            for (let i = 0, n = ring.length - 1; i < n; i++) {
                area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
            }
            return Math.abs(area) / 2;
        }
        this.geoData.features.forEach(feat => {
            if (feat.geometry?.type === 'MultiPolygon') {
                feat.geometry.coordinates = feat.geometry.coordinates.filter(polygon => {
                    const ring = polygon[0];
                    if (!ring || ring.length < 5) return false;  // Need at least 4 unique + closing
                    // Area threshold: ~0.001 sq degrees ≈ a few sq km at India latitudes
                    return ringArea(ring) > 0.001;
                });
            }
        });

        // Filter out features with no pc_name OR no remaining geometry
        this.mapFeatures = this.geoData.features.filter(
            d => d.properties?.pc_name && d.geometry?.coordinates?.length > 0
        );

        // Build a clean FeatureCollection for projection fitting
        const fitCollection = { type: 'FeatureCollection', features: this.mapFeatures };

        // fitExtent takes [[left, top], [right, bottom]] so India fills the
        // SVG with 20px padding on every side — no clipping of northern states.
        const pad = 20;
        this.projection = d3.geoMercator()
            .fitExtent(
                [[pad, pad], [this.width - pad, this.height - pad]],
                fitCollection
            );

        this.path = d3.geoPath().projection(this.projection);

        this.g = this.svg.append("g");

        this.zoom = d3.zoom()
            .scaleExtent([1, 8])
            .on("zoom", (event) => {
                this.g.attr("transform", event.transform);
            });
        this.svg.call(this.zoom);

        // Double-click on the map resets zoom.
        this.svg.on("dblclick.zoom", null);
        this.svg.on("dblclick", () => {
            this.svg.transition().duration(500).call(this.zoom.transform, d3.zoomIdentity);
        });
        this.svg.on("mouseleave", hideTooltip);
        this.container.on("mouseleave", hideTooltip);

        // Wire zoom control buttons
        const zoomStep = 1.6; // factor per button click
        document.getElementById("map-zoom-in")?.addEventListener("click", () => {
            this.svg.transition().duration(300).call(this.zoom.scaleBy, zoomStep);
        });
        document.getElementById("map-zoom-out")?.addEventListener("click", () => {
            this.svg.transition().duration(300).call(this.zoom.scaleBy, 1 / zoomStep);
        });
        document.getElementById("map-zoom-reset")?.addEventListener("click", () => {
            this.svg.transition().duration(400).call(this.zoom.transform, d3.zoomIdentity);
        });

        // Cache for fast filtering: { '2024': { 'PC_NAME': {party: 'BJP', margin: '...', ...} } }
        this.electionData = {};
        this.electionDataNormalized = {};
        // Turnout cache: { '2019': { NORMALIZED_PC_NAME: {Turnout_Percent, Total_Electors, Votes_Polled} } }
        this.turnoutCache = {};
        this.initDataCache();

        // Draw Base Map
        this.drawMap();
    }

    initDataCache() {
        // Group winnersData by Year, then Constituency
        state.winnersData.forEach(d => {
            const yearStr = d.YEAR.toString();
            if (!this.electionData[yearStr]) this.electionData[yearStr] = {};
            if (!this.electionDataNormalized[yearStr]) this.electionDataNormalized[yearStr] = {};
            
            // The GeoJSON PC Names often differ slightly from our dataset. We'll uppercase both for matching.
            const pcName = d.Constituency ? d.Constituency.toUpperCase() : "";
            this.electionData[yearStr][pcName] = d;
            this.electionDataNormalized[yearStr][normalizeConstituencyName(pcName)] = d;
        });

        // Build turnout cache from the new turnout_by_constituency.csv
        // YEAR → normalized constituency name → turnout row
        (state.turnoutData || []).forEach(d => {
            const yearStr = (d.YEAR || d.Year || '').toString();
            if (!yearStr || yearStr === 'NaN') return;
            if (!this.turnoutCache[yearStr]) this.turnoutCache[yearStr] = {};
            const key = normalizeConstituencyName(d.Constituency || '');
            if (key) this.turnoutCache[yearStr][key] = d;
        });
    }

    drawMap() {
        const self = this;

        this.g.selectAll(".constituency")
            .data(this.mapFeatures)
            .enter().append("path")
            .attr("class", "constituency")
            .attr("d", this.path)
            .attr("id", d => `pc-${d.properties.pc_name ? d.properties.pc_name.replace(/\s+/g, '-').toUpperCase() : ''}`)
            .on("mouseover", function(event, d) {
                d3.select(this).style("stroke-width", "1px");
                self.showMapTooltip(event, d);
            })
            .on("mousemove", moveTooltip)
            .on("mouseout", function() {
                d3.select(this).style("stroke-width", "0.2px");
                hideTooltip();
            })
            .on("click", function(event, d) {
                // Brush logic
                const clickedState = d.properties.st_name ? d.properties.st_name.toUpperCase() : null;
                // If already selected, clear it
                if(state.selectedState === clickedState) {
                    setFilter('state', null);
                } else {
                    setFilter('state', clickedState);
                }
            });

    }

    showMapTooltip(event, d) {
        const pcPropName = d.properties.pc_name ? d.properties.pc_name.toUpperCase() : "UNKNOWN";
        const stPropName = d.properties.st_name ? d.properties.st_name.toUpperCase() : "UNKNOWN";
        const yearStr = state.years[state.yearIdx].toString();
        
        const elecData = this.getElectionData(yearStr, pcPropName);
        const turnoutRow = this.turnoutCache[yearStr]?.[normalizeConstituencyName(pcPropName)];
        
        let html = `<div class="tooltip-title">${pcPropName} (${stPropName}) - ${yearStr}</div>`;
        
        if (elecData) {
            const marginPct = elecData.Total_Votes_Const > 0
                ? (elecData.Margin / elecData.Total_Votes_Const * 100).toFixed(1)
                : "—";
            html += `
                <div class="tooltip-row"><span>Winner:</span> <span class="tooltip-val">${elecData.Candidate}</span></div>
                <div class="tooltip-row"><span>Party:</span> <span class="tooltip-val" style="color: ${getPartyColor(elecData.Party)}">${elecData.Party}</span></div>
                <div class="tooltip-row"><span>Margin:</span> <span class="tooltip-val">${elecData.Margin.toLocaleString()} votes (${marginPct}%)</span></div>
            `;
        } else {
            html += `<div class="tooltip-row"><em>No election data available</em></div>`;
        }

        // Add turnout data when available
        if (turnoutRow) {
            const turnoutPct = turnoutRow.Turnout_Percent
                ? parseFloat(turnoutRow.Turnout_Percent).toFixed(1) + '%'
                : '—';
            const electors = turnoutRow.Total_Electors
                ? parseInt(turnoutRow.Total_Electors).toLocaleString()
                : '—';
            const voted = turnoutRow.Votes_Polled_Including_NOTA
                ? parseInt(turnoutRow.Votes_Polled_Including_NOTA).toLocaleString()
                : '—';
            html += `
                <div class="tooltip-divider"></div>
                <div class="tooltip-row"><span>Turnout:</span> <span class="tooltip-val" style="color:#64d2ff">${turnoutPct}</span></div>
                <div class="tooltip-row"><span>Electors:</span> <span class="tooltip-val">${electors}</span></div>
                <div class="tooltip-row"><span>Votes Polled:</span> <span class="tooltip-val">${voted}</span></div>
            `;
        }
        
        showTooltip(html, event);
    }

    render(year, selectedState, selectedParty) {
        const yearStr = year.toString();
        const t = d3.transition().duration(500);
        const marginMix = d3.scaleLinear().domain([0, 0.2]).range([0, 1]).clamp(true);
        const neutral = "#3a3f47";

        this.g.selectAll(".constituency")
            .transition(t)
            .style("fill", d => {
                const pcPropName = d.properties.pc_name ? d.properties.pc_name.toUpperCase() : "UNKNOWN";
                const elecData = this.getElectionData(yearStr, pcPropName);

                if (!elecData) return "#222"; // Missing data

                const marginPct = elecData.Total_Votes_Const > 0
                    ? elecData.Margin / elecData.Total_Votes_Const
                    : 0;
                return d3.interpolateRgb(neutral, getPartyColor(elecData.Party))(marginMix(marginPct));
            })
            .style("opacity", d => {
                // Filter Logic
                const dState = d.properties.st_name ? d.properties.st_name.toUpperCase() : null;
                const elecData = this.getElectionData(yearStr, d.properties.pc_name ? d.properties.pc_name.toUpperCase() : "");
                const dParty = elecData ? elecData.Party : null;

                let isFaded = false;
                if (selectedState && dState !== selectedState) isFaded = true;
                if (selectedParty && dParty !== selectedParty) isFaded = true;

                return isFaded ? 0.15 : 1.0;
            });
            
        this.updateLegend(yearStr);
    }
    
    updateLegend(yearStr) {
        // Find top parties for this year specifically to show in map legend
        const pcCounts = {};
        for (const pc in this.electionData[yearStr]) {
            const party = this.electionData[yearStr][pc].Party;
            pcCounts[party] = (pcCounts[party] || 0) + 1;
        }
        
        const sortedParties = Object.entries(pcCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8); // Top 8 parties
            
        const legendContainer = d3.select("#map-legend");
        legendContainer.html(""); // clear
        
        sortedParties.forEach(([party, count]) => {
            const item = legendContainer.append("span").attr("class", "legend-item");
            item.append("div")
                .attr("class", "color-box")
                .style("background-color", getPartyColor(party));
            item.append("span").text(`${party} (${count})`);
        });
    }

    getElectionData(yearStr, pcName) {
        return this.electionData[yearStr]?.[pcName] ||
            this.electionDataNormalized[yearStr]?.[normalizeConstituencyName(pcName)];
    }
}
