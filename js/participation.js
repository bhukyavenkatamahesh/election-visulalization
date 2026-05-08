class ParticipationView {
    constructor(containerId) {
        this.container = d3.select(containerId);
        this.setupSVG();
    }

    setupSVG() {
        this.container.html("");
        this.container.style("height", "auto");

        // Layout constants (all in SVG user units)
        this.margin      = { top: 20, right: 16, left: 52 };
        this.chartWidth  = 460;
        this.chartHeight = 170;

        // Gender section starts below x-axis + rotated state labels (~60px)
        this.genderY = this.chartHeight + 65;

        // Total viewBox height = top margin + gender section bottom + padding
        const totalH = this.margin.top + this.genderY + 72;  // 72 = title+bar+legend
        const totalW = this.chartWidth + this.margin.left + this.margin.right;

        this.svgEl = this.container.append("svg")
            .attr("viewBox", `0 0 ${totalW} ${totalH}`)
            .attr("preserveAspectRatio", "xMidYMid meet")
            .style("width", "100%")
            .style("display", "block");

        // Inner group offset by margins
        this.svg = this.svgEl.append("g")
            .attr("transform", `translate(${this.margin.left},${this.margin.top})`);

        this.xScale = d3.scaleBand().padding(0.25).range([0, this.chartWidth]);
        this.yScale = d3.scaleLinear().domain([0, 100]).range([this.chartHeight, 0]);

        this.xAxis      = this.svg.append("g").attr("transform", `translate(0,${this.chartHeight})`);
        this.yAxis      = this.svg.append("g");
        this.chartGroup = this.svg.append("g");

        // Gender group — always below the chart + its rotated labels
        this.genderGroup = this.svg.append("g")
            .attr("transform", `translate(0,${this.genderY})`);
    }

    render(year, selectedState) {
        const yr = parseInt(year);
        let turnoutRows = (state.participationData || []).filter(d => d.YEAR === yr);
        let genderRows  = (state.candidateGenderData || []).filter(d => d.YEAR === yr);

        // Fallback: derive turnout from turnout_by_constituency.csv
        if (turnoutRows.length === 0 && state.turnoutData && state.turnoutData.length > 0) {
            const raw = state.turnoutData.filter(d => {
                const rowYear = parseInt(d.YEAR || d.Year || 0);
                return rowYear === yr && d.Turnout_Percent && parseFloat(d.Turnout_Percent) > 0;
            });
            if (raw.length > 0) {
                const byState = d3.rollup(raw,
                    vals => d3.mean(vals, v => parseFloat(v.Turnout_Percent)),
                    v => (v.State || '').toUpperCase()
                );
                turnoutRows = Array.from(byState, ([State, Total_Turnout]) => ({
                    YEAR: yr, State, Total_Turnout
                }));
            }
        }

        // Fallback: derive gender from elections_master.csv
        if (genderRows.length === 0 && state.candidatesData && state.candidatesData.length > 0) {
            const masterYr = state.candidatesData.filter(d =>
                d.YEAR === yr && (d.Gender || d.gender)
            );
            if (masterYr.length > 0) {
                const grouped = d3.rollup(masterYr,
                    vals => vals.length,
                    v => (v.State || 'UNKNOWN').toUpperCase(),
                    v => (v.Gender || v.gender || 'UNKNOWN').toUpperCase()
                );
                genderRows = [];
                grouped.forEach((gMap, State) => {
                    gMap.forEach((Candidates, Gender) => {
                        genderRows.push({ YEAR: yr, State, Gender, Candidates });
                    });
                });
            }
        }

        if (selectedState) {
            turnoutRows = turnoutRows.filter(d => d.State === selectedState);
            genderRows  = genderRows.filter(d => d.State === selectedState);
        }

        this.svgEl.selectAll(".no-data-msg").remove();

        if (turnoutRows.length === 0 && genderRows.length === 0) {
            this.chartGroup.selectAll("*").remove();
            this.genderGroup.selectAll("*").remove();
            this.xAxis.selectAll("*").remove();
            this.yAxis.selectAll("*").remove();
            this.svgEl.append("text").attr("class", "no-data-msg")
                .attr("x", (this.chartWidth + this.margin.left + this.margin.right) / 2)
                .attr("y", this.chartHeight / 2 + this.margin.top)
                .attr("text-anchor", "middle").style("fill", "#888")
                .text("Participation data unavailable for this selection.");
            return;
        }

        this.renderTurnout(year, turnoutRows);
        this.renderGender(year, genderRows);
    }

    renderTurnout(year, rows) {
        const byState = Array.from(
            d3.rollup(rows, vals => d3.mean(vals, d => +d.Total_Turnout), d => d.State),
            ([State, Turnout]) => ({ State, Turnout })
        ).filter(d => Number.isFinite(d.Turnout))
         .sort((a, b) => d3.descending(a.Turnout, b.Turnout))
         .slice(0, 10);

        this.chartGroup.selectAll(".turnout-empty").remove();
        if (byState.length === 0) {
            this.chartGroup.selectAll(".turnout-bar").remove();
            this.xAxis.selectAll("*").remove(); this.yAxis.selectAll("*").remove();
            this.chartGroup.append("text").attr("class", "turnout-empty")
                .attr("x", this.chartWidth / 2).attr("y", 52).attr("text-anchor", "middle")
                .text(`Turnout data unavailable for ${year}.`);
            return;
        }

        this.xScale.domain(byState.map(d => d.State));
        this.yScale.domain([0, Math.max(80, d3.max(byState, d => d.Turnout) || 80)]).nice();

        this.xAxis.call(d3.axisBottom(this.xScale)
            .tickFormat(d => d.length > 9 ? d.slice(0, 8) + '…' : d));
        this.xAxis.selectAll("text")
            .attr("text-anchor", "end").attr("transform", "rotate(-28)")
            .attr("dx", "-0.4em").attr("dy", "0.15em");
        this.yAxis.call(d3.axisLeft(this.yScale).ticks(4).tickFormat(d => `${d}%`));

        const bars = this.chartGroup.selectAll(".turnout-bar").data(byState, d => d.State);
        bars.enter().append("rect").attr("class", "turnout-bar")
            .attr("x", d => this.xScale(d.State)).attr("y", this.yScale(0))
            .attr("width", this.xScale.bandwidth()).attr("height", 0)
            .on("mouseover", (event, d) => showTooltip(`
                <div class="tooltip-title">${d.State} ${year}</div>
                <div class="tooltip-row"><span>Avg. turnout:</span><span class="tooltip-val">${d.Turnout.toFixed(1)}%</span></div>
            `, event))
            .on("mousemove", moveTooltip).on("mouseout", hideTooltip)
            .merge(bars).transition().duration(500)
            .attr("x", d => this.xScale(d.State)).attr("y", d => this.yScale(d.Turnout))
            .attr("width", this.xScale.bandwidth())
            .attr("height", d => this.chartHeight - this.yScale(d.Turnout));
        bars.exit().remove();
    }

    renderGender(year, rows) {
        this.genderGroup.selectAll("*").remove();

        const COLORS = { MALE: "#58a6ff", FEMALE: "#f778ba", OTHER: "#a371f7", TRANSGENDER: "#3fb950" };
        const getColor = g => COLORS[g] || "#888";
        const gScale = d3.scaleLinear().domain([0, 100]).range([0, this.chartWidth]);

        const total = d3.sum(rows, d => d.Candidates);
        if (!total) {
            this.genderGroup.append("text").attr("y", 20).style("fill", "var(--text-secondary)")
                .style("font-size", "10px").text(`Gender data unavailable for ${year}.`);
            return;
        }

        const genders = Array.from(
            d3.rollup(rows, vals => d3.sum(vals, d => d.Candidates), d => d.Gender),
            ([Gender, Candidates]) => ({ Gender, Candidates, Share: Candidates / total * 100 })
        ).sort((a, b) => d3.descending(a.Candidates, b.Candidates));

        // Title
        this.genderGroup.append("text")
            .attr("x", 0).attr("y", 0)
            .style("font-size", "10px").style("font-weight", "600")
            .style("fill", "var(--text-secondary)")
            .text(`Candidate gender mix (${year})`);

        // Stacked bar
        let bx = 0;
        const barY = 8, barH = 20;
        genders.forEach(d => {
            const w = gScale(d.Share);
            this.genderGroup.append("rect")
                .attr("x", bx).attr("y", barY).attr("width", w).attr("height", barH)
                .attr("rx", 2).attr("fill", getColor(d.Gender))
                .on("mouseover", ev => showTooltip(`
                    <div class="tooltip-title">${d.Gender}</div>
                    <div class="tooltip-row"><span>Candidates:</span><span class="tooltip-val">${d.Candidates.toLocaleString()}</span></div>
                    <div class="tooltip-row"><span>Share:</span><span class="tooltip-val">${d.Share.toFixed(1)}%</span></div>
                `, ev))
                .on("mousemove", moveTooltip).on("mouseout", hideTooltip);

            // In-bar % label for wide segments
            if (w > 40) {
                this.genderGroup.append("text")
                    .attr("x", bx + w / 2).attr("y", barY + barH / 2 + 4)
                    .attr("text-anchor", "middle")
                    .style("font-size", "9px").style("font-weight", "700").style("fill", "#0d1117")
                    .text(`${d.Share.toFixed(0)}%`);
            }
            bx += w;
        });

        // Legend row — color swatch + "GENDER: X.X% (N)"
        let lx = 0;
        const legendY = barY + barH + 14;
        const legendSpacing = Math.min(this.chartWidth / genders.length, 148);

        genders.forEach((d, i) => {
            const gx = i * legendSpacing;
            // Color swatch
            this.genderGroup.append("rect")
                .attr("x", gx).attr("y", legendY).attr("width", 10).attr("height", 10)
                .attr("rx", 2).attr("fill", getColor(d.Gender));
            // Label
            this.genderGroup.append("text")
                .attr("x", gx + 13).attr("y", legendY + 9)
                .style("font-size", "9.5px").style("fill", "var(--text-primary)")
                .text(`${d.Gender}: ${d.Share.toFixed(1)}% (${d.Candidates.toLocaleString()})`);
        });
    }
}
