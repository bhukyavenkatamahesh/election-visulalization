class ScatterPlotView {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = d3.select(containerId);
        
        this.margin = {top: 20, right: 30, bottom: 40, left: 60};
        this.setupSVG();
        
        this.masterData = state.candidatesData;

        // Pre-build a winner lookup from winnersData for join: year+constituency+candidate → Is_Winner
        // keyed as `${year}|${normalizeConstituencyName(constituency)}|${candidate.toUpperCase().trim()}`
        this.winnerLookup = new Map();
        state.winnersData.forEach(w => {
            const key = `${w.YEAR}|${normalizeConstituencyName(w.Constituency)}|${(w.Candidate||'').toUpperCase().trim()}`;
            this.winnerLookup.set(key, 1);
        });

        // Pre-build myneta lookup: normalized constituency+candidate → myneta row
        // so we can enrich 2019 master data with education/age fields
        this.mynetaLookup = new Map();
        (state.mynetaData || []).forEach(m => {
            const key = `${normalizeConstituencyName(m.Constituency)}|${(m.Candidate||'').toUpperCase().trim()}`;
            this.mynetaLookup.set(key, m);
        });

        this.drawBase();
    }

    setupSVG() {
        this.container.html("");
        const size = getChartSize(this.container, this.margin, 760, 360);
        this.width = size.width;
        this.height = size.height;
        
        this.svg = this.container.append('svg')
            .attr("viewBox", `0 0 ${this.width + this.margin.left + this.margin.right} ${this.height + this.margin.top + this.margin.bottom}`)
            .append("g")
            .attr("transform", `translate(${this.margin.left},${this.margin.top})`);
            
        // Zoom area
        this.svg.append("rect")
            .attr("width", this.width)
            .attr("height", this.height)
            .style("fill", "none")
            .style("pointer-events", "all");
    }

    drawBase() {
        // We use a pseudo-log scale for Assets because of massive wealth disparity
        // x => log10(x + 1) to handle zeroes
        this.xScale = d3.scaleSymlog()
            .constant(10000) // Handles 0 well
            .range([0, this.width]);
            
        this.yScale = d3.scaleLinear()
            .range([this.height, 0]);

        this.rScale = d3.scaleSqrt()
            .domain([0, 50]) // Criminal cases usually 0-50
            .range([2, 12])
            .clamp(true);

        this.xAxis = this.svg.append("g")
            .attr("transform", `translate(0,${this.height})`);
            
        this.yAxis = this.svg.append("g");
        
        // Axis Labels
        this.svg.append("text")
            .attr("class", "axis-label x-axis-label")
            .attr("text-anchor", "middle")
            .attr("x", this.width / 2)
            .attr("y", this.height + 35)
            .text("Declared Total Assets (₹)");

        this.svg.append("text")
            .attr("class", "axis-label")
            .attr("text-anchor", "middle")
            .attr("transform", "rotate(-90)")
            .attr("y", -45)
            .attr("x", -this.height / 2)
            .text("Votes Received");
            
        this.dotsGroup = this.svg.append("g");
    }

    render(year, selectedState, selectedParty) {
        const t = d3.transition().duration(750);
        const yr = parseInt(year);
        
        let data;
        let useAssets = false; // flag: true = x-axis is assets, false = x-axis is vote share

        if (yr === 2019 && state.mynetaData.length > 0) {
            // 2019: use the full myneta dataset (all 7,472 candidates with assets)
            useAssets = true;
            data = state.mynetaData
                .filter(m => m.State && !m.State.toString().startsWith('BYE'))
                .map(m => {
                    const normConst = normalizeConstituencyName(m.Constituency);
                    const normName  = (m.Candidate || '').toUpperCase().trim();
                    const isWinner  = this.winnerLookup.has(`2019|${normConst}|${normName}`) ? 1 : 0;
                    const winnerRow = isWinner
                        ? state.winnersData.find(w =>
                            w.YEAR === 2019 &&
                            normalizeConstituencyName(w.Constituency) === normConst &&
                            (w.Candidate || '').toUpperCase().trim() === normName)
                        : null;
                    return {
                        YEAR: 2019,
                        State: m.State,
                        Constituency: m.Constituency,
                        Candidate: m.Candidate,
                        Party: m.Party,
                        Total_Assets: m.Total_Assets,
                        Criminal_Cases: m.Criminal_Cases,
                        Education: m.Education,
                        Age: m.Age,
                        Votes: winnerRow ? (winnerRow.Votes || 0) : 0,
                        Vote_Share_Percent: winnerRow ? (winnerRow.Vote_Share_Percent || 0) : 0,
                        Is_Winner: isWinner
                    };
                })
                .filter(d => !isNaN(parseFloat(d.Total_Assets)) && parseFloat(d.Total_Assets) > 0);
        } else {
            // Other years: use master dataset — show all candidates with votes > 0
            data = this.masterData.filter(d => d.YEAR === yr && parseFloat(d.Votes) > 0);
            // Check if this year has meaningful asset coverage (>10% of rows have non-zero assets)
            const withAssets = data.filter(d => parseFloat(d.Total_Assets) > 0).length;
            useAssets = withAssets / (data.length || 1) > 0.10;
            if (useAssets) {
                data = data.filter(d => parseFloat(d.Total_Assets) > 0);
            }
        }
        
        // State Filter
        if (selectedState) {
            data = data.filter(d => d.State && d.State.toUpperCase() === selectedState);
        }

        // If no data, show message
        if (data.length === 0) {
            this.dotsGroup.selectAll("*").remove();
            this.xAxis.selectAll("*").remove();
            this.yAxis.selectAll("*").remove();
            this.svg.selectAll(".no-data-msg").remove();
            this.svg.append("text")
                .attr("class", "no-data-msg")
                .attr("x", this.width/2).attr("y", this.height/2)
                .attr("text-anchor", "middle").style("fill", "#888")
                .text("No candidate data for this selection.");
            return;
        } else {
            this.svg.selectAll(".no-data-msg").remove();
        }

        // Update X-axis label depending on mode
        this.svg.select(".x-axis-label")
            .text(useAssets ? "Declared Total Assets (₹)" : "Vote Share (%)");

        // Update Domains
        const maxVotes = d3.max(data, d => parseFloat(d.Votes) || 0) || 1000000;

        if (useAssets) {
            const maxAssets = d3.max(data, d => parseFloat(d.Total_Assets)) || 10000000;
            // Always use symlog for assets (handles huge wealth spread without log(0) issues)
            this.xScale = d3.scaleSymlog().constant(10000).range([0, this.width]).domain([0, maxAssets]);
        } else {
            // Vote share: plain linear 0–100%
            this.xScale = d3.scaleLinear().range([0, this.width]).domain([0, 100]);
        }
        this.yScale.domain([0, maxVotes]);

        // Draw Axes with transition
        if (useAssets) {
            this.xAxis.transition(t).call(
                d3.axisBottom(this.xScale)
                  .tickValues([0, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10])
                  .tickFormat(d => {
                      if(d === 0) return "0";
                      if(d === 1e5) return "1L";
                      if(d === 1e6) return "10L";
                      if(d === 1e7) return "1Cr";
                      if(d === 1e8) return "10Cr";
                      if(d === 1e9) return "100Cr";
                      if(d === 1e10) return "1000Cr";
                      return d;
                  })
            );
        } else {
            this.xAxis.transition(t).call(
                d3.axisBottom(this.xScale).ticks(10).tickFormat(d => d + '%')
            );
        }
        this.yAxis.transition(t).call(
            d3.axisLeft(this.yScale).ticks(6).tickFormat(d3.format(".1s"))
        );

        // Bind Dots
        const dots = this.dotsGroup.selectAll(".candidate-dot").data(data, d => `${d.Constituency}-${d.Candidate}`);
        const self = this;

        // Enter
        dots.enter()
            .append("circle")
            .attr("class", d => `candidate-dot ${d.Is_Winner === 1 ? 'winner' : 'loser'}`)
            .attr("cx", d => useAssets
                ? self.xScale(parseFloat(d.Total_Assets) || 0)
                : self.xScale(parseFloat(d.Vote_Share_Percent) || 0))
            .attr("cy", this.height)
            .attr("r", 0)
            .on("mouseover", function(event, d) {
                d3.select(this).style("stroke", "#fff").style("opacity", 1).style("stroke-width", "2px");
                const educLine = d.Education ? `<div class="tooltip-row"><span>Education:</span> <span class="tooltip-val">${d.Education}</span></div>` : '';
                const ageLine = d.Age ? `<div class="tooltip-row"><span>Age:</span> <span class="tooltip-val">${d.Age}</span></div>` : '';
                const assetsLine = useAssets
                    ? `<div class="tooltip-row"><span>Assets:</span> <span class="tooltip-val">₹${(parseFloat(d.Total_Assets)||0).toLocaleString()}</span></div>`
                    : `<div class="tooltip-row"><span>Vote Share:</span> <span class="tooltip-val">${(parseFloat(d.Vote_Share_Percent)||0).toFixed(1)}%</span></div>`;
                const votesVal = parseFloat(d.Votes) > 0 ? parseFloat(d.Votes).toLocaleString() : '—';
                showTooltip(`
                    <div class="tooltip-title">${d.Candidate} ${d.Is_Winner ? '✓ Winner' : ''}</div>
                    <div class="tooltip-row"><span>Party:</span> <span class="tooltip-val" style="color:${getPartyColor(d.Party)}">${d.Party}</span></div>
                    <div class="tooltip-row"><span>Constituency:</span> <span class="tooltip-val">${d.Constituency}</span></div>
                    <div class="tooltip-row"><span>Votes:</span> <span class="tooltip-val">${votesVal}</span></div>
                    ${assetsLine}
                    <div class="tooltip-row"><span>Criminal Cases:</span> <span class="tooltip-val" style="${d.Criminal_Cases>0?'color:#ff4444':''}">${d.Criminal_Cases || 0}</span></div>
                    ${educLine}${ageLine}
                `, event);
            })
            .on("mousemove", moveTooltip)
            .on("mouseout", function() {
                d3.select(this).style("stroke", "var(--panel-bg)").style("opacity", null).style("stroke-width", "0.5px");
                hideTooltip();
            })
            .merge(dots)
            .transition(t)
            .attr("cx", d => useAssets
                ? self.xScale(parseFloat(d.Total_Assets) || 0)
                : self.xScale(parseFloat(d.Vote_Share_Percent) || 0))
            .attr("cy", d => self.yScale(parseFloat(d.Votes) || 0))
            .attr("r", d => self.rScale(parseFloat(d.Criminal_Cases) || 0))
            .style("opacity", d => {
                if (selectedParty && d.Party !== selectedParty) return 0.05;
                return d.Is_Winner === 1 ? 0.9 : 0.45;
            });

        // Exit
        dots.exit().transition(t).attr("r", 0).remove();
            
        // Bring winners to front
        this.dotsGroup.selectAll('.winner').raise();
    }
}

