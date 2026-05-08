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

        this.projection = d3.geoMercator()
            .center([82.8, 22.5])
            .scale(this.height * 1.5)
            .translate([this.width / 2, this.height / 2]);

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
        
        // Cache for fast filtering: { '2024': { 'PC_NAME': {party: 'BJP', margin: '...', ...} } }
        this.electionData = {};
        this.electionDataNormalized = {};
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

        // Quick state boundary extraction (dissolving PCs by state is complex without topojson, 
        // but we'll try to just draw the PCs and use CSS to make boundaries subtle)
    }

    drawMap() {
        const self = this;

        // Draw constituencies, ignoring features without a pc_name (e.g. bounding boxes)
        this.g.selectAll(".constituency")
            .data(this.geoData.features.filter(d => d.properties.pc_name))
            .enter().append("path")
            .attr("class", "constituency")
            .attr("d", this.path)
            .attr("id", d => `pc-${d.properties.pc_name ? d.properties.pc_name.replace(/\s+/g, '-').toUpperCase() : ''}`)
            .on("mouseover", function(event, d) {
                d3.select(this).style("stroke-width", "1.5px");
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
            html += `<div class="tooltip-row"><em>No data available</em></div>`;
        }
        
        showTooltip(html, event);
    }

    render(year, selectedState, selectedParty) {
        const yearStr = year.toString();
        const t = d3.transition().duration(500);

        this.g.selectAll(".constituency")
            .transition(t)
            .style("fill", d => {
                const pcPropName = d.properties.pc_name ? d.properties.pc_name.toUpperCase() : "UNKNOWN";
                const elecData = this.getElectionData(yearStr, pcPropName);

                if (!elecData) return "#222"; // Missing data

                return getPartyColor(elecData.Party);
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
