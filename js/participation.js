class ParticipationView {
    constructor(containerId) {
        this.container = d3.select(containerId);
        this.margin = { top: 24, right: 24, bottom: 68, left: 56 };
        this.setupSVG();
    }

    setupSVG() {
        this.container.html("");
        const size = getChartSize(this.container, this.margin, 520, 360);
        this.width = size.width;
        this.height = size.height;

        this.svg = this.container.append("svg")
            .attr("viewBox", `0 0 ${this.width + this.margin.left + this.margin.right} ${this.height + this.margin.top + this.margin.bottom}`)
            .append("g")
            .attr("transform", `translate(${this.margin.left},${this.margin.top})`);

        this.xScale = d3.scaleBand().padding(0.25).range([0, this.width]);
        this.yScale = d3.scaleLinear().domain([0, 100]).range([this.height, 0]);
        this.genderScale = d3.scaleLinear().domain([0, 100]).range([0, this.width]);

        this.xAxis = this.svg.append("g").attr("transform", `translate(0,${this.height})`);
        this.yAxis = this.svg.append("g");
        this.chartGroup = this.svg.append("g");
        // Leave enough space below turnout bars for gender section (bar + callout + legend)
        this.genderGroup = this.svg.append("g").attr("transform", `translate(0,${Math.max(95, this.height - 95)})`);
    }

    render(year, selectedState) {
        const yr = parseInt(year);
        const allParticipation = state.participationData || [];
        const allGender = state.candidateGenderData || [];

        let turnoutRows = allParticipation.filter(d => d.YEAR === yr);
        let genderRows  = allGender.filter(d => d.YEAR === yr);

        // --- Fallback: derive turnout from turnout_by_constituency.csv for missing years (e.g. 2024) ---
        if (turnoutRows.length === 0 && state.turnoutData && state.turnoutData.length > 0) {
            const raw = state.turnoutData.filter(d => {
                const rowYear = parseInt(d.YEAR || d.Year || 0);
                return rowYear === yr && d.Turnout_Percent && parseFloat(d.Turnout_Percent) > 0;
            });
            if (raw.length > 0) {
                const byState = d3.rollup(
                    raw,
                    vals => d3.mean(vals, v => parseFloat(v.Turnout_Percent)),
                    v => (v.State || '').toUpperCase()
                );
                turnoutRows = Array.from(byState, ([State, Total_Turnout]) => ({
                    YEAR: yr, State, Total_Turnout,
                    Coverage_Note: `Derived from constituency-level turnout data (${yr}).`
                }));
            }
        }

        // --- Fallback: derive gender from elections_master.csv for missing years (e.g. 2024) ---
        if (genderRows.length === 0 && state.candidatesData && state.candidatesData.length > 0) {
            const masterYr = state.candidatesData.filter(d => d.YEAR === yr && d.Gender);
            if (masterYr.length > 0) {
                const grouped = d3.rollup(
                    masterYr,
                    vals => vals.length,
                    v => (v.State || 'UNKNOWN').toUpperCase(),
                    v => (v.Gender || 'UNKNOWN').toUpperCase()
                );
                genderRows = [];
                grouped.forEach((genderMap, State) => {
                    genderMap.forEach((Candidates, Gender) => {
                        genderRows.push({ YEAR: yr, State, Gender, Candidates });
                    });
                });
            }
        }

        if (selectedState) {
            turnoutRows = turnoutRows.filter(d => d.State === selectedState);
            genderRows  = genderRows.filter(d => d.State === selectedState);
        }

        this.svg.selectAll(".no-data-msg").remove();

        if (turnoutRows.length === 0 && genderRows.length === 0) {
            this.chartGroup.selectAll("*").remove();
            this.genderGroup.selectAll("*").remove();
            this.xAxis.selectAll("*").remove();
            this.yAxis.selectAll("*").remove();
            this.svg.append("text")
                .attr("class", "no-data-msg")
                .attr("x", this.width / 2)
                .attr("y", this.height / 2)
                .attr("text-anchor", "middle")
                .style("fill", "#888")
                .text("Participation data unavailable for this selection.");
            return;
        }

        this.renderTurnout(year, turnoutRows);
        this.renderGender(year, genderRows);
    }

    renderTurnout(year, rows) {
        const byState = Array.from(
            d3.rollup(
                rows,
                values => d3.mean(values, d => +d.Total_Turnout),
                d => d.State
            ),
            ([State, Turnout]) => ({ State, Turnout })
        )
            .filter(d => Number.isFinite(d.Turnout))
            .sort((a, b) => d3.descending(a.Turnout, b.Turnout))
            .slice(0, state.selectedState ? 12 : 10);

        this.chartGroup.selectAll(".turnout-empty").remove();
        if (byState.length === 0) {
            this.chartGroup.selectAll(".turnout-bar").remove();
            this.xAxis.selectAll("*").remove();
            this.yAxis.selectAll("*").remove();
            this.chartGroup.append("text")
                .attr("class", "turnout-empty")
                .attr("x", this.width / 2)
                .attr("y", 52)
                .attr("text-anchor", "middle")
                .text(`Turnout coverage is unavailable for ${year}.`);
            return;
        }

        this.xScale.domain(byState.map(d => d.State));
        this.yScale.domain([0, Math.max(80, d3.max(byState, d => d.Turnout) || 80)]).nice();

        this.xAxis.call(d3.axisBottom(this.xScale).tickFormat(d => d.length > 11 ? `${d.slice(0, 10)}...` : d));
        this.xAxis.selectAll("text")
            .attr("text-anchor", "end")
            .attr("transform", "rotate(-30)")
            .attr("dx", "-0.45em")
            .attr("dy", "0.25em");
        this.yAxis.call(d3.axisLeft(this.yScale).ticks(5).tickFormat(d => `${d}%`));

        const bars = this.chartGroup.selectAll(".turnout-bar").data(byState, d => d.State);

        bars.enter()
            .append("rect")
            .attr("class", "turnout-bar")
            .attr("x", d => this.xScale(d.State))
            .attr("y", this.yScale(0))
            .attr("width", this.xScale.bandwidth())
            .attr("height", 0)
            .on("mouseover", (event, d) => {
                showTooltip(`
                    <div class="tooltip-title">${d.State} ${year}</div>
                    <div class="tooltip-row"><span>Avg. turnout:</span> <span class="tooltip-val">${d.Turnout.toFixed(1)}%</span></div>
                `, event);
            })
            .on("mousemove", moveTooltip)
            .on("mouseout", hideTooltip)
            .merge(bars)
            .transition().duration(500)
            .attr("x", d => this.xScale(d.State))
            .attr("y", d => this.yScale(d.Turnout))
            .attr("width", this.xScale.bandwidth())
            .attr("height", d => this.height - this.yScale(d.Turnout));

        bars.exit().remove();

        const sourceNote = rows.find(d => d.Coverage_Note)?.Coverage_Note || "";
        const note = sourceNote.startsWith("Approximate")
            ? "2019 turnout is approximate; NOTA may be excluded."
            : sourceNote ? "Official turnout where source data is available." : "";
        const notes = this.chartGroup.selectAll(".coverage-note").data(note ? [note] : []);
        notes.enter()
            .append("text")
            .attr("class", "coverage-note")
            .attr("x", 0)
            .attr("y", 12)
            .merge(notes)
            .text(d => d);
        notes.exit().remove();
    }

    renderGender(year, rows) {
        this.genderGroup.selectAll("*").remove();

        const total = d3.sum(rows, d => d.Candidates);
        if (!total) {
            this.genderGroup.append("text")
                .attr("class", "small-note")
                .attr("x", 0)
                .attr("y", 30)
                .text(`Candidate gender coverage is unavailable for ${year}.`);
            return;
        }

        const genders = Array.from(
            d3.rollup(rows, values => d3.sum(values, d => d.Candidates), d => d.Gender),
            ([Gender, Candidates]) => ({ Gender, Candidates, Share: Candidates / total * 100 })
        ).sort((a, b) => d3.descending(a.Candidates, b.Candidates));

        const color = d3.scaleOrdinal()
            .domain(["MALE", "FEMALE", "OTHER", "TRANSGENDER"])
            .range(["#58a6ff", "#f778ba", "#a371f7", "#3fb950"]);

        // Title
        this.genderGroup.append("text")
            .attr("class", "gender-title")
            .attr("x", 0)
            .attr("y", -8)
            .text(`Candidate gender mix (${year})`);

        // Stacked bar with smart labels
        const barY = 8;
        const barH = 24;
        const calloutY = barY + barH + 12;

        let x = 0;
        genders.forEach(d => {
            const w = this.genderScale(d.Share);
            const midX = x + w / 2;

            // Segment rect
            this.genderGroup.append("rect")
                .attr("class", "gender-segment")
                .attr("x", x)
                .attr("y", barY)
                .attr("width", w)
                .attr("height", barH)
                .attr("fill", color(d.Gender))
                .on("mouseover", (event) => {
                    showTooltip(`
                        <div class="tooltip-title">${d.Gender}</div>
                        <div class="tooltip-row"><span>Candidates:</span> <span class="tooltip-val">${d.Candidates.toLocaleString()}</span></div>
                        <div class="tooltip-row"><span>Share:</span> <span class="tooltip-val">${d.Share.toFixed(1)}%</span></div>
                    `, event);
                })
                .on("mousemove", moveTooltip)
                .on("mouseout", hideTooltip);

            if (w >= 50) {
                // Wide enough: show label inside the bar
                this.genderGroup.append("text")
                    .attr("class", "gender-label")
                    .attr("x", midX)
                    .attr("y", barY + barH / 2 + 4)
                    .attr("text-anchor", "middle")
                    .style("font-size", "10px")
                    .text(`${d.Share.toFixed(0)}%`);
            } else {
                // Narrow: tick line + colored pill label below the bar
                this.genderGroup.append("line")
                    .attr("x1", midX).attr("y1", barY + barH)
                    .attr("x2", midX).attr("y2", calloutY)
                    .attr("stroke", color(d.Gender))
                    .attr("stroke-width", 1.5);

                const labelText = `${d.Share.toFixed(1)}%`;
                const pillW = labelText.length * 6 + 12;
                const pillX = Math.min(Math.max(midX - pillW / 2, 0), this.width - pillW);

                this.genderGroup.append("rect")
                    .attr("x", pillX).attr("y", calloutY)
                    .attr("width", pillW).attr("height", 16)
                    .attr("rx", 3)
                    .attr("fill", color(d.Gender));

                this.genderGroup.append("text")
                    .attr("x", pillX + pillW / 2).attr("y", calloutY + 11)
                    .attr("text-anchor", "middle")
                    .style("font-size", "9px")
                    .style("fill", "#0d1117")
                    .style("font-weight", "700")
                    .text(labelText);
            }

            x += w;
        });

        // Always-visible legend row below bar + callouts
        const legendY = calloutY + 24;
        const itemSpacing = Math.min(this.width / genders.length, 150);
        genders.forEach((d, i) => {
            const g = this.genderGroup.append("g")
                .attr("transform", `translate(${i * itemSpacing}, ${legendY})`);
            g.append("rect")
                .attr("width", 10).attr("height", 10).attr("rx", 2)
                .attr("fill", color(d.Gender));
            g.append("text")
                .attr("x", 14).attr("y", 9)
                .style("font-size", "10px")
                .style("fill", "var(--text-secondary)")
                .text(`${d.Gender}: ${d.Share.toFixed(1)}% (${d.Candidates.toLocaleString()})`);
        });
    }
}
