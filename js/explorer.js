/**
 * Explorer tab: an open-ended graph of resources (instances).
 *
 * Resources are added as seeds ("Open in Explorer"). Double-clicking a node expands its
 * links to other resources in both directions (arrows show the real triple direction);
 * double-clicking it again collapses them, removing any nodes that are no longer connected
 * to a seed. After each expansion the whole graph is
 * re-laid out with a force-directed (cose) layout computed off-screen, the clicked node is
 * kept where it was, and the other nodes glide straight to their new positions.
 */

import { apiGet } from './api.js';

let cy = null;
const seeds = new Set();     // node ids (URIs) added via openInExplorer
const expanded = new Set();  // node ids whose outbound links are currently shown
let busy = false;            // an expansion/layout is in progress

const LINK_LIMIT = 100;      // max links added per expansion, per direction
const NODE_MIN_WIDTH = 70;
const NODE_MAX_WIDTH = 200;
const NODE_FONT_SIZE = 13;

function nodeSize(label) {
  // Approximate text width: ~0.55em per character, wrapped at NODE_MAX_WIDTH
  const textWidth = label.length * NODE_FONT_SIZE * 0.55;
  const width = Math.max(NODE_MIN_WIDTH, Math.min(NODE_MAX_WIDTH, textWidth + 24));
  const lines = Math.max(1, Math.ceil(textWidth / (NODE_MAX_WIDTH - 24)));
  return { w: width, h: 18 + lines * NODE_FONT_SIZE * 1.25, tw: width - 16 };
}

function explorerStyle() {
  return [
    {
      selector: 'node',
      style: {
        'shape': 'round-rectangle',
        'label': 'data(label)',
        'width': 'data(w)',
        'height': 'data(h)',
        'text-wrap': 'wrap',
        'text-max-width': 'data(tw)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': NODE_FONT_SIZE + 'px',
        'color': '#222',
        'background-color': '#eef4fb',
        'border-width': 1.5,
        'border-color': '#4a7fc1'
      }
    },
    {
      selector: 'node.expanded',
      style: { 'background-color': '#d3e4f7' }
    },
    {
      selector: 'node.seed',
      style: { 'border-width': 3 }
    },
    {
      selector: 'node:selected',
      style: { 'border-color': '#e8890c', 'border-width': 3 }
    },
    // Same look as the property edges in the Class Diagram: label offset along the edge
    {
      selector: 'edge',
      style: {
        'width': 2,
        'line-color': '#333333',
        'target-arrow-color': '#333333',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'arrow-scale': 1.2,
        'label': ele => ele.data('label') ? `⁠\n${ele.data('label')}\n⁠` : '',
        'font-size': '13px',
        'text-wrap': 'wrap',
        'text-rotation': 'autorotate',
        'text-margin-y': -10,
        'color': '#333333'
      }
    }
  ];
}

function ensureCy() {
  if (cy) return cy;
  const container = document.getElementById('explorer-container');
  cy = cytoscape({
    container,
    elements: [],
    style: explorerStyle(),
    layout: { name: 'preset' },
    minZoom: 0.1,
    maxZoom: 4,
    boxSelectionEnabled: false
  });

  cy.on('dbltap', 'node', evt => toggleNode(evt.target));
  cy.on('tap', 'node', evt => showSelection(evt.target));
  cy.on('tap', evt => { if (evt.target === cy) showSelection(null); });
  return cy;
}

function setStatus(html) {
  const el = document.getElementById('explorer-status');
  if (el) el.innerHTML = html;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function jsArg(value) {
  return JSON.stringify(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function showSelection(node) {
  if (!node) {
    setStatus('');
    return;
  }
  const uri = node.id();
  setStatus(`<strong>${escapeHtml(node.data('label'))}</strong>
    <span style="color:#666; margin-left:6px; word-break:break-all;">${escapeHtml(uri)}</span>
    <button style="margin-left:8px;" onclick="showExplorerNodeDetails(${jsArg(uri)})">Details</button>`);
}

function addNode(uri, label, position, isSeed = false) {
  const size = nodeSize(label);
  const node = cy.add({
    group: 'nodes',
    data: { id: uri, label, ...size },
    position
  });
  if (isSeed) node.addClass('seed');
  return node;
}

/**
 * Add a resource to the Explorer and switch to the tab. Called from the resource details view.
 * @param {string} uri - URI of the resource to add
 */
export async function openInExplorer(uri) {
  window.switchTab('explorer');
  ensureCy();
  cy.resize();

  const existing = cy.getElementById(uri);
  if (existing.nonempty()) {
    if (!seeds.has(uri)) {
      seeds.add(uri);
      existing.addClass('seed');
    }
    cy.nodes().unselect();
    existing.select();
    showSelection(existing);
    cy.animate({ center: { eles: existing } }, { duration: 300 });
    return;
  }

  let label = uri;
  try {
    const data = await apiGet(`/resource_links?uri=${encodeURIComponent(uri)}&limit=1`);
    label = data.label;
  } catch (error) {
    setStatus(`<span style="color:#dc3545;">Could not load ${escapeHtml(uri)}: ${escapeHtml(String(error.message || error))}</span>`);
    return;
  }

  // First resource goes in the middle; later ones to the right of what's already there
  let position = { x: 0, y: 0 };
  if (cy.nodes().nonempty()) {
    const bb = cy.nodes().boundingBox();
    position = { x: bb.x2 + 150, y: (bb.y1 + bb.y2) / 2 };
  }
  const node = addNode(uri, label, position, true);
  seeds.add(uri);

  cy.nodes().unselect();
  node.select();
  showSelection(node);
  if (cy.nodes().length === 1) {
    cy.zoom(1);
    cy.center(node);
  } else {
    cy.animate({ center: { eles: node } }, { duration: 300 });
  }
}

async function toggleNode(node) {
  if (busy) return;
  if (expanded.has(node.id())) {
    collapseNode(node);
  } else {
    await expandNode(node);
  }
}

async function expandNode(node) {
  busy = true;
  const uri = node.id();
  let data;
  try {
    data = await apiGet(`/resource_links?uri=${encodeURIComponent(uri)}&limit=${LINK_LIMIT}`);
  } catch (error) {
    setStatus(`<span style="color:#dc3545;">Could not expand: ${escapeHtml(String(error.message || error))}</span>`);
    busy = false;
    return;
  }

  expanded.add(uri);
  node.addClass('expanded');

  if (data.links.length === 0) {
    setStatus(`<strong>${escapeHtml(data.label)}</strong> has no links to other resources.`);
    busy = false;
    return;
  }

  // The resource at the far end of each link, with its print name
  const others = data.links.map(l => l.direction === 'out'
    ? { uri: l.object, label: l.object_label }
    : { uri: l.subject, label: l.subject_label });

  // New neighbours start on a circle around the clicked node, so the layout opens outwards from it
  const center = node.position();
  const newUris = [...new Set(others.map(o => o.uri))].filter(u => cy.getElementById(u).empty());
  const radius = 120 + newUris.length * 6;

  cy.batch(() => {
    data.links.forEach((link, idx) => {
      const other = others[idx];
      if (cy.getElementById(other.uri).empty()) {
        const angle = (2 * Math.PI * newUris.indexOf(other.uri)) / newUris.length;
        addNode(other.uri, other.label, {
          x: center.x + radius * Math.cos(angle),
          y: center.y + radius * Math.sin(angle)
        });
      }
      // One edge per triple, whichever end it was expanded from; remember who added it
      const edgeId = `${link.subject}\u0000${link.predicate}\u0000${link.object}`;
      const edge = cy.getElementById(edgeId);
      if (edge.empty()) {
        cy.add({
          group: 'edges',
          data: { id: edgeId, source: link.subject, target: link.object,
                  label: link.predicate_label, predicate: link.predicate, owners: [uri] }
        });
      } else if (!edge.data('owners').includes(uri)) {
        edge.data('owners', [...edge.data('owners'), uri]);
      }
    });
  });

  const notes = [];
  const shownOut = data.links.filter(l => l.direction === 'out').length;
  const shownIn = data.links.length - shownOut;
  if (data.outbound_total > shownOut) notes.push(`${shownOut} of ${data.outbound_total.toLocaleString()} outbound`);
  if (data.inbound_total > shownIn) notes.push(`${shownIn} of ${data.inbound_total.toLocaleString()} inbound`);
  if (notes.length) {
    setStatus(`Showing ${notes.join(' and ')} links for <strong>${escapeHtml(data.label)}</strong>.`);
  }

  await relayout(node);
  busy = false;
}

function collapseNode(node) {
  const uri = node.id();
  expanded.delete(uri);
  node.removeClass('expanded');
  // Drop this node's claim on the edges it added; remove edges nobody else added
  node.connectedEdges().forEach(edge => {
    const owners = edge.data('owners').filter(o => o !== uri);
    if (owners.length === 0) {
      edge.remove();
    } else {
      edge.data('owners', owners);
    }
  });
  pruneUnreachable();
}

/**
 * Remove nodes that are no longer connected to any seed (edges count in either direction).
 */
function pruneUnreachable() {
  const reachable = new Set();
  const queue = [...seeds].filter(id => cy.getElementById(id).nonempty());
  queue.forEach(id => reachable.add(id));
  while (queue.length) {
    const id = queue.shift();
    cy.getElementById(id).neighborhood('node').forEach(n => {
      if (!reachable.has(n.id())) {
        reachable.add(n.id());
        queue.push(n.id());
      }
    });
  }
  const orphans = cy.nodes().filter(n => !reachable.has(n.id()));
  orphans.forEach(n => expanded.delete(n.id()));
  orphans.remove();
}

/**
 * Re-lay out the whole graph around a fixed anchor node.
 * The force-directed layout runs without animation (no visible springing); then the anchor
 * is restored to its old position and every other node animates directly to its new place.
 */
async function relayout(anchor) {
  const anchorPos = { ...anchor.position() };
  const start = new Map();
  cy.nodes().forEach(n => start.set(n.id(), { ...n.position() }));

  const layout = cy.layout({
    name: 'cose',
    animate: false,
    randomize: false,
    fit: false,
    nodeDimensionsIncludeLabels: true,
    idealEdgeLength: () => 140,
    edgeElasticity: () => 100,
    nodeRepulsion: () => 600000,
    nodeOverlap: 20,
    gravity: 0.2,
    componentSpacing: 120,
    numIter: 1500
  });
  const done = layout.promiseOn('layoutstop');
  layout.run();
  await done;

  // Keep the clicked node exactly where it was by shifting the whole result
  const dx = anchorPos.x - anchor.position().x;
  const dy = anchorPos.y - anchor.position().y;
  const target = new Map();
  cy.nodes().forEach(n => {
    const p = n.position();
    target.set(n.id(), { x: p.x + dx, y: p.y + dy });
  });

  // Jump back to the starting positions, then glide to the new ones
  cy.batch(() => cy.nodes().forEach(n => n.position(start.get(n.id()))));
  const animations = cy.nodes().map(n =>
    n.animation({ position: target.get(n.id()) }, { duration: 350, easing: 'ease-out' }).play().promise()
  );
  await Promise.all(animations);
}

/**
 * Fit the whole Explorer graph on screen.
 */
export function fitExplorer() {
  if (!cy || cy.nodes().empty()) return;
  cy.animate({ fit: { eles: cy.nodes(), padding: 40 } }, { duration: 300 });
}

/**
 * Remove everything from the Explorer.
 */
export function clearExplorer() {
  seeds.clear();
  expanded.clear();
  busy = false;
  if (cy) cy.elements().remove();
  setStatus('');
}

/**
 * Called when the Explorer tab becomes visible, so Cytoscape picks up the container size.
 */
export function onExplorerShown() {
  if (cy) cy.resize();
}
