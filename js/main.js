/**
 * Global State Manager
 * Handles data loading and dispatches events to the 4 D3 views
 */

// Global State
const state = {
    years: [2004, 2009, 2014, 2019, 2024],
    yearIdx: 3, // Default to 2019 because all dashboard panels have source coverage.
    selectedState: null, // "All"
    selectedParty: null, // "All"
    
    // Datasets
    candidatesData: [],       // Master results
    winnersData: [],          // Winner map data
    partyRanks: [],           // Bump chart data
    geoData: null,            // TopoJSON/GeoJSON
    participationData: [],
    candidateGenderData: [],
    mynetaData: [],           // Full 2019 candidate affidavit data (7,472 records)
    turnoutData: [],          // Constituency-level turnout 2004-2024
};

// Global Party Color Mapping
const partyColors = {
    'BJP': '#FF9933',
    'INC': '#19AAED',
    'AITC': '#20C646',
    'SP': '#FF2222',
    'BSP': '#22409A',
    'CPI(M)': '#DE0000',
    'CPI': '#DE0000',
    'JD(U)': '#003366',
    'TDP': '#F3E500',
    'YSRCP': '#008080',
    'SHS': '#E35E14',
    'AAP': '#0066A4',
    'IND': '#AAAAAA',
    'OTHERS': '#555555'
};

function getPartyColor(party) {
    return partyColors[party] || partyColors['OTHERS'];
}

function normalizeConstituencyName(name) {
    return (name || "")
        .toString()
        .toUpperCase()
        .replace(/&/g, "AND")
        .replace(/[^A-Z0-9]+/g, "");
}

function getChartSize(container, margin, fallbackWidth = 640, fallbackHeight = 320) {
    const node = container.node();
    const rect = node ? node.getBoundingClientRect() : {};
    const rawWidth = rect.width || parseInt(container.style("width"), 10) || fallbackWidth;
    const rawHeight = rect.height || parseInt(container.style("height"), 10) || fallbackHeight;

    return {
        width: Math.max(260, rawWidth - margin.left - margin.right),
        height: Math.max(190, rawHeight - margin.top - margin.bottom)
    };
}

// Global View Instances
let mapView, bumpView, scatterView, sankeyView, participationView;

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Loading datasets...");
    try {
        // Load core datasets concurrently (required — any failure is fatal)
        const [masterCSV, winnersCSV, ranksCSV, topoData, participationCSV, genderCSV] = await Promise.all([
            d3.csv('public/data/elections_master.csv', d3.autoType),
            d3.csv('public/data/winners_map.csv', d3.autoType),
            d3.csv('public/data/party_ranks.csv', d3.autoType),
            d3.json('public/data/india_pc_2019_simplified.geojson'),
            d3.csv('public/data/participation_summary.csv', d3.autoType),
            d3.csv('public/data/candidate_gender_summary.csv', d3.autoType)
        ]);

        // Load enrichment datasets gracefully (optional — degrade silently if unavailable)
        const [mynetaCSV, turnoutCSV] = await Promise.all([
            d3.csv('public/data/candidates_2019_myneta_full.csv', d3.autoType).catch(() => []),
            d3.csv('public/data/turnout_by_constituency.csv', d3.autoType).catch(() => [])
        ]);

        state.candidatesData = masterCSV;
        state.winnersData = winnersCSV;
        state.partyRanks = ranksCSV;
        state.geoData = topoData;
        state.participationData = participationCSV;
        state.candidateGenderData = genderCSV;
        state.mynetaData  = Array.isArray(mynetaCSV)  ? mynetaCSV  : [];
        state.turnoutData = Array.isArray(turnoutCSV) ? turnoutCSV : [];

        console.log(`Data loaded: ${state.mynetaData.length} myneta rows, ${state.turnoutData.length} turnout rows`);


        console.log("Data loaded successfully!");
        document.getElementById('app-status').classList.add('hidden');
        
        // Initialize UI wire-up
        initControls();
        
        // Render Views
        mapView = new MapView('#map-viz');
        bumpView = new BumpChartView('#bump-viz');
        scatterView = new ScatterPlotView('#scatter-viz');
        sankeyView = new SankeyView('#sankey-viz');
        participationView = new ParticipationView('#participation-viz');
        
        // force initial render
        updateViews();
    } catch (e) {
        console.error("Error loading data:", e);
        const status = document.getElementById('app-status');
        status.classList.remove('hidden');
        status.textContent = "Data could not be loaded. Serve the project over HTTP and check the data files in public/data.";
        status.classList.add('error');
    }
});

function initControls() {
    const slider = document.getElementById('year-slider');
    const yearLabel = document.getElementById('current-year-label');
    
    slider.addEventListener('input', (e) => {
        state.yearIdx = parseInt(e.target.value);
        yearLabel.textContent = state.years[state.yearIdx];
        updateViews(); // Trigger view updates
    });

    document.getElementById('clear-state-btn').addEventListener('click', () => {
        setFilter('state', null);
    });
    
    document.getElementById('clear-party-btn').addEventListener('click', () => {
        setFilter('party', null);
    });
}

// Global dispatch to all views
function updateViews() {
    const currentYear = state.years[state.yearIdx];
    
    // Update active badges
    const stBadge = document.getElementById('state-filter-badge');
    if(state.selectedState) {
        stBadge.classList.remove('hidden');
        document.getElementById('selected-state-name').textContent = state.selectedState;
    } else {
        stBadge.classList.add('hidden');
    }

    const ptBadge = document.getElementById('party-filter-badge');
    if(state.selectedParty) {
        ptBadge.classList.remove('hidden');
        document.getElementById('selected-party-name').textContent = state.selectedParty;
    } else {
        ptBadge.classList.add('hidden');
    }

    // Call individual views (if they exist)
    if(mapView) mapView.render(currentYear, state.selectedState, state.selectedParty);
    if(bumpView) bumpView.render(state.selectedState); // Bump chart shows all years
    if(scatterView) scatterView.render(currentYear, state.selectedState, state.selectedParty);
    if(sankeyView) sankeyView.render(state.selectedState); // Sankey shows all years flow
    if(participationView) participationView.render(currentYear, state.selectedState);
}

// Method for Views to update global state (Brushing)
function setFilter(type, value) {
    if (type === 'state') state.selectedState = value;
    if (type === 'party') state.selectedParty = value;
    updateViews();
}

// Tooltip helper
const tooltip = d3.select("#global-tooltip");

function positionTooltip(e) {
    const node = tooltip.node();
    const w = node.offsetWidth || 240;
    const h = node.offsetHeight || 120;
    const pad = 15;
    // Flip to the left/above the cursor when it would overflow the viewport.
    let left = e.pageX + pad;
    let top = e.pageY + pad;
    if (left + w > window.innerWidth) left = e.pageX - w - pad;
    if (top + h > window.innerHeight) top = e.pageY - h - pad;
    tooltip.style("left", left + "px").style("top", top + "px");
}

function showTooltip(html, e) {
    tooltip.html(html).classed("hidden", false);
    positionTooltip(e);
}

function moveTooltip(e) {
    positionTooltip(e);
}

function hideTooltip() {
    tooltip.classed("hidden", true);
}
