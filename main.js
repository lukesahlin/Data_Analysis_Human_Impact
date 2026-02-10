(function () {
  'use strict';

  const DATA_URL = 'data/Most-Recent-Cohorts-Institution.csv';
  const US_ATLAS_URL = 'https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json';

  const STABBR_TO_FIPS = {
    AL: 1, AK: 2, AZ: 4, AR: 5, CA: 6, CO: 8, CT: 9, DE: 10, DC: 11, FL: 12, GA: 13,
    HI: 15, ID: 16, IL: 17, IN: 18, IA: 19, KS: 20, KY: 21, LA: 22, ME: 23, MD: 24,
    MA: 25, MI: 26, MN: 27, MS: 28, MO: 29, MT: 30, NE: 31, NV: 32, NH: 33, NJ: 34,
    NM: 35, NY: 36, NC: 37, ND: 38, OH: 39, OK: 40, OR: 41, PA: 42, RI: 44, SC: 45,
    SD: 46, TN: 47, TX: 48, UT: 49, VT: 50, VA: 51, WA: 53, WV: 54, WI: 55, WY: 56
  };

  const ID_COLS = ['UNITID', 'INSTNM', 'CITY', 'STABBR', 'CONTROL', 'REGION'];
  const NUMERIC_COLS = [
    'ADM_RATE', 'SAT_AVG', 'UGDS', 'COSTT4_A', 'TUITIONFEE_IN', 'TUITIONFEE_OUT',
    'INEXPFTE', 'AVGFACSAL', 'PCTPELL', 'UGDS_WHITE', 'UGDS_BLACK', 'UGDS_HISP', 'UGDS_ASIAN', 'PPTUG_EF',
    'C150_4', 'C200_4', 'MD_EARN_WNE_P10', 'DEBT_MDN', 'GRAD_DEBT_MDN', 'RPY_3YR_RT', 'RET_FT4', 'CDR3'
  ];
  const PARALLEL_COLS = ['ADM_RATE', 'SAT_AVG', 'PCTPELL', 'COSTT4_A', 'C150_4', 'MD_EARN_WNE_P10', 'DEBT_MDN'];
  const PARALLEL_AXES = ['ADM_RATE', 'SAT_AVG', 'PCTPELL', 'COSTT4_A', 'MD_EARN_WNE_P10', 'DEBT_MDN'];
  const COLOR_BY = 'C150_4';

  const CONTROL_LABELS = { '1': 'Public', '2': 'Private nonprofit', '3': 'Private for-profit' };
  const REGION_LABELS = {
    '0': 'US Service Schools', '1': 'New England', '2': 'Mid East', '3': 'Great Lakes',
    '4': 'Plains', '5': 'Southeast', '6': 'Southwest', '7': 'Rocky Mountains',
    '8': 'Far West', '9': 'Outlying Areas'
  };

  let rawData = [];
  let filteredData = [];
  let brushedIndices = null;
  let usStatesGeojson = null;
  let filterUpdateGeneration = 0;

  function parseNum(v) {
    if (v == null || v === '' || String(v).toUpperCase() === 'NA' || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function preprocess(rows) {
    const allCols = [...ID_COLS, ...NUMERIC_COLS];
    return rows.map((d, i) => {
      const out = { _index: i };
      allCols.forEach(k => {
        if (NUMERIC_COLS.includes(k)) {
          out[k] = parseNum(d[k]);
        } else {
          out[k] = d[k] != null ? String(d[k]).trim() : '';
        }
      });
      return out;
    });
  }

  function filterRowsWithEnoughData(data, cols, minPresent = 0.5) {
    return data.filter(d => {
      let present = 0;
      cols.forEach(c => {
        if (d[c] != null && d[c] !== '') present++;
      });
      return present >= cols.length * minPresent;
    });
  }

  function getSelectedValues(name) {
    return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`), el => el.value);
  }

  function getFiltered() {
    let data = rawData;
    const controls = getSelectedValues('filter-control');
    const regions = getSelectedValues('filter-region');
    if (controls.length) data = data.filter(d => controls.includes(String(d.CONTROL)));
    if (regions.length) data = data.filter(d => regions.includes(String(d.REGION)));
    return data;
  }

  function getDisplayData() {
    let data = filteredData;
    if (brushedIndices != null) {
      const set = new Set(brushedIndices);
      data = data.filter(d => set.has(d._index));
    }
    return data;
  }

  function getSelectionSummary() {
    const controls = getSelectedValues('filter-control');
    const regions = getSelectedValues('filter-region');
    const typeText = controls.length === 0 ? 'All types' : controls.map(v => CONTROL_LABELS[v] || v).join(', ');
    const regionText = regions.length === 0 ? 'All regions' : regions.map(v => REGION_LABELS[v] || v).join(', ');
    return typeText + ' • ' + regionText;
  }

  function showFilterUpdating() {
    const updatingEl = document.getElementById('filter-summary-updating');
    const countEl = document.getElementById('filter-summary-count');
    const selectionEl = document.getElementById('filter-summary-selection');
    const filtersEl = document.getElementById('filters');
    if (updatingEl) { updatingEl.hidden = false; }
    if (countEl) { countEl.hidden = true; }
    if (selectionEl) { selectionEl.hidden = true; }
    if (filtersEl) {
      filtersEl.classList.add('filters--updating');
      filtersEl.setAttribute('aria-busy', 'true');
    }
  }

  function updateFilterSummary() {
    const loadingEl = document.getElementById('filter-summary-loading');
    const updatingEl = document.getElementById('filter-summary-updating');
    const countEl = document.getElementById('filter-summary-count');
    const selectionEl = document.getElementById('filter-summary-selection');
    const filtersEl = document.getElementById('filters');
    if (loadingEl) loadingEl.hidden = true;
    if (updatingEl) updatingEl.hidden = true;
    if (countEl) {
      countEl.hidden = false;
      countEl.textContent = `Showing ${filteredData.length.toLocaleString()} of ${rawData.length.toLocaleString()} institutions.`;
    }
    if (selectionEl) {
      selectionEl.hidden = false;
      selectionEl.textContent = getSelectionSummary();
    }
    if (filtersEl) {
      filtersEl.classList.remove('filters--loading', 'filters--updating');
      filtersEl.setAttribute('aria-busy', 'false');
    }
  }

  function setFilterLoading(loading) {
    const filtersEl = document.getElementById('filters');
    if (!filtersEl) return;
    if (loading) {
      filtersEl.classList.add('filters--loading');
      filtersEl.setAttribute('aria-busy', 'true');
    } else {
      filtersEl.classList.remove('filters--loading');
      filtersEl.setAttribute('aria-busy', 'false');
    }
  }

  /** Pearson correlation matrix: for each pair of columns, r across rows (colleges). */
  function correlationMatrix(arr, cols) {
    const n = cols.length;
    const mat = Array(n).fill(0).map(() => Array(n).fill(0));
    const valid = arr.filter(d => cols.every(c => d[c] != null && Number.isFinite(d[c])));
    if (valid.length < 2) return mat;
    cols.forEach((c, i) => {
      cols.forEach((c2, j) => {
        const xs = valid.map(d => d[c]);
        const ys = valid.map(d => d[c2]);
        const mx = d3.mean(xs);
        const my = d3.mean(ys);
        let num = 0, denX = 0, denY = 0;
        for (let k = 0; k < xs.length; k++) {
          num += (xs[k] - mx) * (ys[k] - my);
          denX += (xs[k] - mx) ** 2;
          denY += (ys[k] - my) ** 2;
        }
        const den = Math.sqrt(denX * denY) || 1;
        mat[i][j] = den === 0 ? 0 : num / den;
        if (Number.isNaN(mat[i][j])) mat[i][j] = 0;
      });
    });
    return mat;
  }

  function shortLabel(key) {
    const labels = {
      ADM_RATE: 'Adm. rate',
      SAT_AVG: 'SAT avg',
      PCTPELL: '% Pell',
      COSTT4_A: 'Cost',
      C150_4: 'Completion',
      MD_EARN_WNE_P10: 'Earnings',
      DEBT_MDN: 'Debt',
      UGDS: 'Enrollment',
      TUITIONFEE_IN: 'Tuition in',
      TUITIONFEE_OUT: 'Tuition out',
      INEXPFTE: 'Spend/FTE',
      AVGFACSAL: 'Fac. salary',
      UGDS_WHITE: '% White',
      UGDS_BLACK: '% Black',
      UGDS_HISP: '% Hisp.',
      UGDS_ASIAN: '% Asian',
      PPTUG_EF: '% Part-time',
      C200_4: 'Comp. 200',
      GRAD_DEBT_MDN: 'Grad debt',
      RPY_3YR_RT: 'Repay 3yr',
      RET_FT4: 'Retention',
      CDR3: 'Default 3yr'
    };
    return labels[key] || key;
  }

  function drawParallelCoords(container, data, dimensions) {
    container.selectAll('*').remove();
    if (!data.length) {
      container.append('div').attr('class', 'loading').text('No data to display.');
      return;
    }

    const margin = { top: 24, right: 16, bottom: 52, left: 16 };
    const width = Math.max(400, container.node().getBoundingClientRect().width - margin.left - margin.right);
    const height = 320;

    const svg = container.append('svg')
      .attr('width', width + margin.left + margin.right)
      .attr('height', height + margin.top + margin.bottom)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scalePoint()
      .domain(dimensions)
      .range([0, width])
      .padding(0.2);

    const colorScale = d3.scaleSequential(d3.interpolateViridis)
      .domain(d3.extent(data, d => d[COLOR_BY]).filter(x => x != null));

    const yScales = {};
    dimensions.forEach(dim => {
      const vals = data.map(d => d[dim]).filter(x => x != null && Number.isFinite(x));
      if (vals.length) {
        const ext = d3.extent(vals);
        if (ext[0] === ext[1]) ext[1] = ext[0] + 1;
        yScales[dim] = d3.scaleLinear().domain(ext).range([height, 0]);
      }
    });

    const line = d3.line()
      .defined(d => d[1] != null && Number.isFinite(d[1]))
      .x(d => xScale(d[0]))
      .y(d => yScales[d[0]] ? yScales[d[0]](d[1]) : height / 2);

    const brushedSet = brushedIndices != null ? new Set(brushedIndices) : null;
    const paths = svg.append('g').attr('class', 'paths');
    paths.selectAll('path')
      .data(data)
      .join('path')
      .attr('d', d => line(dimensions.map(dim => [dim, d[dim]])))
      .attr('fill', 'none')
      .attr('stroke', d => (d[COLOR_BY] != null ? colorScale(d[COLOR_BY]) : '#ccc'))
      .attr('stroke-width', d => (brushedSet && brushedSet.has(d._index) ? 1.5 : 0.8))
      .attr('stroke-opacity', d => (brushedSet && brushedSet.has(d._index) ? 0.85 : 0.15))
      .attr('data-index', d => d._index);

    dimensions.forEach(dim => {
      const axis = svg.append('g').attr('class', 'axis').attr('transform', `translate(${xScale(dim)},0)`);
      if (yScales[dim]) {
        axis.call(d3.axisLeft(yScales[dim]).ticks(4).tickSize(-width));
      }
      axis.selectAll('.domain').remove();
      axis.selectAll('.tick line').attr('stroke', '#eee');
      axis.append('text')
        .attr('class', 'axis-label')
        .attr('y', -8)
        .attr('text-anchor', 'middle')
        .text(shortLabel(dim));
    });

    const brush = d3.brushY()
      .extent([[-8, 0], [8, height]])
      .on('brush end', function (event) {
        if (!event.selection) {
          brushedIndices = null;
        } else {
          const [y0, y1] = event.selection;
          const dim = event.target.__dim;
          const scale = yScales[dim];
          if (scale) {
            const v0 = scale.invert(y1);
            const v1 = scale.invert(y0);
            brushedIndices = data.filter(d => d[dim] != null && d[dim] >= v0 && d[dim] <= v1).map(d => d._index);
          }
        }
        updateAllViews();
      });

    dimensions.forEach((dim) => {
      const brushG = svg.append('g')
        .attr('class', 'brush')
        .attr('transform', `translate(${xScale(dim) - 8},0)`);
      brushG.call(brush);
      brushG.selectAll('.overlay').attr('width', 16);
      brushG.selectAll('.handle').attr('width', 16);
      brushG.node().__dim = dim;
    });

    const legend = svg.append('g').attr('class', 'legend').attr('transform', `translate(0,${height + 12})`);
    const legScale = d3.scaleLinear().domain(colorScale.domain()).range([0, 120]);
    const legAxis = d3.axisBottom(legScale).ticks(4).tickFormat(d => d != null ? (d * 100).toFixed(0) + '%' : '');
    legend.append('g').call(legAxis);
    legend.append('text').attr('y', -6).attr('text-anchor', 'middle').attr('x', 60).text(shortLabel(COLOR_BY));
    const defs = svg.append('defs');
    const lg = defs.append('linearGradient').attr('id', 'parallel-legend-gradient').attr('x1', '0%').attr('x2', '100%');
    lg.selectAll('stop').data([0, 1]).join('stop').attr('offset', (d, i) => i).attr('stop-color', (d, i) => d3.interpolateViridis(i));
    legend.append('rect').attr('x', 0).attr('y', -10).attr('width', 120).attr('height', 8).attr('fill', 'url(#parallel-legend-gradient)');
  }

  function drawCorrelationMatrix(container, data, cols) {
    container.selectAll('*').remove();
    if (!data.length) {
      container.append('div').attr('class', 'loading').text('No data to display.');
      return;
    }

    const mat = correlationMatrix(data, cols);
    const margin = { top: 100, right: 24, bottom: 72, left: 100 };
    const containerWidth = container.node().getBoundingClientRect().width - margin.left - margin.right;
    const cellSize = Math.min(72, Math.max(52, containerWidth / cols.length));
    const totalWidth = cols.length * cellSize;
    const totalHeight = cols.length * cellSize;
    const width = totalWidth + margin.left + margin.right;
    const height = totalHeight + margin.top + margin.bottom;

    const svg = container.append('svg').attr('width', width).attr('height', height);
    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const colorScale = d3.scaleDiverging(d3.interpolateRdBu).domain([1, 0, -1]);
    const x = d3.scaleBand().domain(cols).range([0, totalWidth]).padding(0.05);
    const y = d3.scaleBand().domain([...cols].reverse()).range([0, totalHeight]).padding(0.05);

    let tooltip = d3.select('body').select('.tooltip');
    if (tooltip.empty()) tooltip = d3.select('body').append('div').attr('class', 'tooltip').style('opacity', 0);

    g.selectAll('rect')
      .data(d3.cross(cols, [...cols].reverse(), (a, b) => ({ i: cols.indexOf(a), j: cols.indexOf(b), a, b })))
      .join('rect')
      .attr('x', d => x(d.a))
      .attr('y', d => y(d.b))
      .attr('width', x.bandwidth())
      .attr('height', y.bandwidth())
      .attr('fill', d => colorScale(mat[d.j][d.i]))
      .attr('stroke', '#fff')
      .attr('stroke-width', 0.5)
      .on('mouseover', function (event, d) {
        tooltip.style('opacity', 1)
          .html(`${shortLabel(d.a)} vs ${shortLabel(d.b)}<br>r = ${mat[d.j][d.i].toFixed(3)}`)
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY + 10) + 'px');
      })
      .on('mouseout', () => tooltip.style('opacity', 0));

    cols.forEach((c) => {
      g.append('text')
        .attr('class', 'axis-label')
        .attr('x', x(c) + x.bandwidth() / 2)
        .attr('y', -6)
        .attr('text-anchor', 'middle')
        .attr('transform', `rotate(-45, ${x(c) + x.bandwidth() / 2}, -6)`)
        .text(shortLabel(c));
      g.append('text')
        .attr('class', 'axis-label')
        .attr('x', -6)
        .attr('y', y(c) + y.bandwidth() / 2)
        .attr('text-anchor', 'end')
        .attr('dominant-baseline', 'middle')
        .attr('transform', `rotate(-90, -6, ${y(c) + y.bandwidth() / 2})`)
        .text(shortLabel(c));
    });
    const legG = svg.append('g').attr('class', 'corr-legend').attr('transform', `translate(${margin.left + totalWidth / 2 - 60},${margin.top + totalHeight + 8})`);
    legG.append('text').attr('y', 0).attr('text-anchor', 'middle').attr('x', 60).text('Correlation r');
    const defs = svg.append('defs');
    const lg = defs.append('linearGradient').attr('id', 'corr-legend-gradient').attr('x1', '0%').attr('x2', '100%');
    lg.selectAll('stop').data([0, 0.5, 1]).join('stop').attr('offset', (d, i) => i / 2).attr('stop-color', (d, i) => d3.interpolateRdBu(1 - i / 2));
    legG.append('rect').attr('x', 0).attr('y', 4).attr('width', 120).attr('height', 10).attr('fill', 'url(#corr-legend-gradient)');
    legG.append('text').attr('x', 0).attr('y', 22).attr('font-size', 10).text('-1');
    legG.append('text').attr('x', 120).attr('y', 22).attr('text-anchor', 'end').attr('font-size', 10).text('1');
  }

  function stateStatsFromData(data) {
    const byState = d3.rollup(
      data.filter(d => d.C150_4 != null && Number.isFinite(d.C150_4)),
      v => ({ median: d3.median(v, d => d.C150_4), count: v.length }),
      d => String(d.STABBR).toUpperCase()
    );
    const stats = {};
    byState.forEach((val, stabbr) => {
      const fips = STABBR_TO_FIPS[stabbr];
      if (fips != null) stats[fips] = { medianCompletion: val.median, count: val.count };
    });
    return stats;
  }

  function drawMap(container, data) {
    container.selectAll('*').remove();
    if (!usStatesGeojson) {
      container.append('div').attr('class', 'loading').text('Loading map…');
      return;
    }
    const stateStats = stateStatsFromData(data);
    const completions = Object.values(stateStats).map(d => d.medianCompletion).filter(x => x != null);
    const colorScale = d3.scaleSequential(d3.interpolateViridis)
      .domain(completions.length ? d3.extent(completions) : [0, 1]);

    const el = container.node();
    const width = Math.max(400, el.getBoundingClientRect().width);
    const height = Math.max(320, Math.min(400, width * 0.6));

    const projection = d3.geoAlbersUsa().fitSize([width, height], usStatesGeojson);
    const path = d3.geoPath(projection);

    const svg = container.append('svg').attr('width', width).attr('height', height).attr('viewBox', [0, 0, width, height]);

    const tooltip = d3.select('body').selectAll('.tooltip').empty()
      ? d3.select('body').append('div').attr('class', 'tooltip').style('opacity', 0)
      : d3.select('body').select('.tooltip').style('opacity', 0);

    const fips = d => (typeof d.id === 'string' ? parseInt(d.id, 10) : d.id);

    svg.append('g')
      .selectAll('path')
      .data(usStatesGeojson.features)
      .join('path')
      .attr('d', path)
      .attr('fill', d => {
        const s = stateStats[fips(d)];
        return s && s.medianCompletion != null ? colorScale(s.medianCompletion) : '#eee';
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .on('mouseover', function (event, d) {
        const s = stateStats[fips(d)];
        const msg = s
          ? `Median completion: ${(s.medianCompletion * 100).toFixed(1)}% (${s.count} schools)`
          : 'No data';
        tooltip.style('opacity', 1).html(msg)
          .style('left', (event.pageX + 10) + 'px').style('top', (event.pageY + 10) + 'px');
      })
      .on('mouseout', () => tooltip.style('opacity', 0));

    const leg = svg.append('g').attr('class', 'legend').attr('transform', `translate(${width - 130},${height - 32})`);
    const legScale = d3.scaleLinear().domain(colorScale.domain()).range([0, 100]);
    leg.append('rect').attr('x', 0).attr('y', -6).attr('width', 100).attr('height', 8)
      .attr('fill', 'url(#map-legend-gradient)');
    const defs = svg.append('defs');
    const lg = defs.append('linearGradient').attr('id', 'map-legend-gradient').attr('x1', '0%').attr('x2', '100%');
    lg.selectAll('stop').data([0, 1]).join('stop').attr('offset', (d, i) => i).attr('stop-color', (d, i) => d3.interpolateViridis(i));
    leg.append('text').attr('x', 50).attr('y', -10).attr('text-anchor', 'middle').attr('font-size', 10).text('Completion rate (low → high)');
    leg.append('text').attr('x', 0).attr('y', 18).attr('font-size', 9).text(completions.length ? (colorScale.domain()[0] * 100).toFixed(0) + '%' : '—');
    leg.append('text').attr('x', 100).attr('y', 18).attr('text-anchor', 'end').attr('font-size', 9).text(completions.length ? (colorScale.domain()[1] * 100).toFixed(0) + '%' : '—');
    leg.append('text').attr('x', 0).attr('y', 28).attr('font-size', 8).attr('fill', '#666').text('Low');
    leg.append('text').attr('x', 100).attr('y', 28).attr('text-anchor', 'end').attr('font-size', 8).attr('fill', '#666').text('High');
  }

  function drawScatterMatrix(container, data, cols) {
    container.selectAll('*').remove();
    if (!data.length) {
      container.append('div').attr('class', 'loading').text('No data to display.');
      return;
    }

    const n = cols.length;
    const cellSize = Math.min(120, (Math.min(700, container.node().getBoundingClientRect().width) - 80) / n);
    const size = n * cellSize;
    const margin = { top: 60, right: 20, bottom: 60, left: 60 };
    const width = size + margin.left + margin.right;
    const height = size + margin.top + margin.bottom;

    const svg = container.append('svg').attr('width', width).attr('height', height);
    const colorScale = d3.scaleSequential(d3.interpolateViridis).domain(d3.extent(data, d => d[COLOR_BY]).filter(x => x != null));
    const brushedSet = brushedIndices != null ? new Set(brushedIndices) : null;

    const tooltip = d3.select('body').selectAll('.tooltip').empty()
      ? d3.select('body').append('div').attr('class', 'tooltip').style('opacity', 0)
      : d3.select('body').select('.tooltip').style('opacity', 0);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const g = svg.append('g')
          .attr('transform', `translate(${margin.left + j * cellSize},${margin.top + i * cellSize})`);

        const xDim = cols[j];
        const yDim = cols[i];
        const xVals = data.map(d => d[xDim]).filter(x => x != null && Number.isFinite(x));
        const yVals = data.map(d => d[yDim]).filter(x => x != null && Number.isFinite(x));
        const xExt = d3.extent(xVals);
        const yExt = d3.extent(yVals);
        if (xExt[0] === xExt[1]) xExt[1] = xExt[0] + 1;
        if (yExt[0] === yExt[1]) yExt[1] = yExt[0] + 1;
        const xScale = d3.scaleLinear().domain(xExt).range([2, cellSize - 2]);
        const yScale = d3.scaleLinear().domain(yExt).range([cellSize - 2, 2]);

        const points = data.filter(d => d[xDim] != null && d[yDim] != null && Number.isFinite(d[xDim]) && Number.isFinite(d[yDim]));

        const cellG = g.append('g').attr('class', 'cell');
        cellG.selectAll('circle')
          .data(points)
          .join('circle')
          .attr('cx', d => xScale(d[xDim]))
          .attr('cy', d => yScale(d[yDim]))
          .attr('r', 2)
          .attr('fill', d => (d[COLOR_BY] != null ? colorScale(d[COLOR_BY]) : '#ccc'))
          .attr('fill-opacity', d => {
            if (brushedSet == null) return 0.5;
            return brushedSet.has(d._index) ? 0.9 : 0.12;
          })
          .attr('stroke', d => (brushedSet && brushedSet.has(d._index) ? '#333' : 'none'))
          .attr('stroke-width', 0.5)
          .on('mouseover', function (event, d) {
            tooltip.style('opacity', 1)
              .html(`${d.INSTNM || 'Institution'}<br>${shortLabel(xDim)}: ${d[xDim] != null ? d[xDim].toFixed(2) : '—'}<br>${shortLabel(yDim)}: ${d[yDim] != null ? d[yDim].toFixed(2) : '—'}`)
              .style('left', (event.pageX + 10) + 'px')
              .style('top', (event.pageY + 10) + 'px');
          })
          .on('mouseout', () => tooltip.style('opacity', 0));

        const brush = d3.brush()
          .extent([[0, 0], [cellSize, cellSize]])
          .on('end', function (event) {
            if (!event.selection) {
              brushedIndices = null;
            } else {
              const [[sx0, sy0], [sx1, sy1]] = event.selection;
              const x0 = xScale.invert(sx0), x1 = xScale.invert(sx1);
              const y0 = yScale.invert(sy0), y1 = yScale.invert(sy1);
              const xLo = Math.min(x0, x1), xHi = Math.max(x0, x1);
              const yLo = Math.min(y0, y1), yHi = Math.max(y0, y1);
              brushedIndices = data.filter(d => d[xDim] != null && d[yDim] != null &&
                d[xDim] >= xLo && d[xDim] <= xHi && d[yDim] >= yLo && d[yDim] <= yHi).map(d => d._index);
            }
            updateAllViews();
          });
        g.append('g').attr('class', 'brush').call(brush);

        if (i === 0) {
          g.append('text').attr('class', 'axis-label').attr('x', cellSize / 2).attr('y', -8).attr('text-anchor', 'middle').text(shortLabel(xDim));
        }
        if (j === 0) {
          g.append('text').attr('class', 'axis-label').attr('x', -8).attr('y', cellSize / 2).attr('text-anchor', 'end').attr('dominant-baseline', 'middle').attr('transform', `rotate(-90, -8, ${cellSize / 2})`).text(shortLabel(yDim));
        }
      }
    }
  }

  function updateAllViews() {
    const display = getDisplayData();
    const parallelEl = document.getElementById('parallel-coords');
    const mapEl = document.getElementById('us-map');
    const correlationEl = document.getElementById('correlation-matrix');
    const scatterEl = document.getElementById('scatter-matrix');
    drawParallelCoords(d3.select(parallelEl), filteredData, PARALLEL_AXES);
    if (mapEl) drawMap(d3.select(mapEl), filteredData);
    drawCorrelationMatrix(d3.select(correlationEl), display, PARALLEL_COLS);
    drawScatterMatrix(d3.select(scatterEl), display, PARALLEL_COLS);
    updateFilterSummary();
  }

  function applyFilters() {
    filterUpdateGeneration += 1;
    const generation = filterUpdateGeneration;
    showFilterUpdating();
    requestAnimationFrame(() => {
      if (generation !== filterUpdateGeneration) return;
      filteredData = getFiltered();
      brushedIndices = null;
      updateAllViews();
    });
  }

  function initFilters() {
    document.getElementById('filters').addEventListener('change', (e) => {
      if (e.target.matches('input[name="filter-control"], input[name="filter-region"]')) {
        requestAnimationFrame(() => applyFilters());
      }
    });
    document.querySelectorAll('.filter-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-for');
        const boxes = document.querySelectorAll(`input[name="${name}"]`);
        const allChecked = Array.from(boxes).every(cb => cb.checked);
        boxes.forEach(cb => { cb.checked = !allChecked; });
        requestAnimationFrame(() => applyFilters());
      });
    });
    document.getElementById('reset-filters').addEventListener('click', () => {
      document.querySelectorAll('input[name="filter-control"], input[name="filter-region"]').forEach(cb => { cb.checked = false; });
      applyFilters();
    });
  }

  function init() {
    initFilters();
    const parallelEl = document.getElementById('parallel-coords');
    const mapEl = document.getElementById('us-map');
    const correlationEl = document.getElementById('correlation-matrix');
    const scatterEl = document.getElementById('scatter-matrix');
    parallelEl.innerHTML = '<div class="loading">Loading data…</div>';
    if (mapEl) mapEl.innerHTML = '<div class="loading">Loading map…</div>';
    correlationEl.innerHTML = '<div class="loading">Loading data…</div>';
    scatterEl.innerHTML = '<div class="loading">Loading data…</div>';

    Promise.all([
      d3.csv(DATA_URL),
      d3.json(US_ATLAS_URL).catch(() => null)
    ]).then(([csv, us]) => {
      if (us && typeof topojson !== 'undefined' && us.objects && us.objects.states) {
        usStatesGeojson = topojson.feature(us, us.objects.states);
      }
      rawData = preprocess(csv);
      rawData = filterRowsWithEnoughData(rawData, PARALLEL_COLS, 0.5);
      filteredData = getFiltered();
      updateAllViews();
    }).catch(err => {
      parallelEl.innerHTML = '<div class="loading">Failed to load data. Ensure data/Most-Recent-Cohorts-Institution.csv exists.</div>';
      if (mapEl) mapEl.innerHTML = '';
      correlationEl.innerHTML = '';
      scatterEl.innerHTML = '';
      const loadingEl = document.getElementById('filter-summary-loading');
      const updatingEl = document.getElementById('filter-summary-updating');
      const countEl = document.getElementById('filter-summary-count');
      const filtersEl = document.getElementById('filters');
      if (loadingEl) loadingEl.hidden = true;
      if (updatingEl) updatingEl.hidden = true;
      if (countEl) { countEl.hidden = false; countEl.textContent = 'Error loading data.'; }
      if (filtersEl) { filtersEl.classList.remove('filters--loading', 'filters--updating'); filtersEl.setAttribute('aria-busy', 'false'); }
      console.error(err);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
