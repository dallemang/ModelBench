/**
 * Ring-based layout for multiple graphs - each graph gets its own ring
 * with force-directed ring placement and angular optimization
 */

// ── Effective ring map ───────────────────────────────────────────

/**
 * Build a map of nodeURI -> ringGraph, indicating which ring each node
 * actually lives in. A node's effective ring is the graph_source of the
 * top-level hierarchy root whose subtree it belongs to.  This differs
 * from graph_source when a node is displaced (e.g. a Purple node that
 * is a subclass of a Green node lives in Green's ring).
 */
function buildEffectiveRingMap(hierarchy) {
  const effectiveRing = {};
  function mark(node, ringGraph) {
    effectiveRing[node.uri] = ringGraph;
    if (node.children) {
      node.children.forEach(child => mark(child, ringGraph));
    }
  }
  hierarchy.forEach(root => mark(root, root.graph_source || 'unknown'));
  return effectiveRing;
}

// ── Cross-ontology connection analysis ──────────────────────────

/**
 * Analyze all cross-ontology connections in the hierarchy.
 *
 * Returns two separate connection maps:
 * - graphPairWeights: for force-directed ring placement (based on graph_source —
 *   which ontologies are connected)
 * - nodeNeighborRings: for angular optimization (based on effectiveRing —
 *   which ring each target node actually lives in, accounting for displaced nodes)
 */
function analyzeCrossOntologyConnections(hierarchy, effectiveRing) {
  // Build URI -> graph_source map for every node
  const nodeGraphMap = {};
  function mapAll(node) {
    nodeGraphMap[node.uri] = node.graph_source || 'unknown';
    if (node.children) node.children.forEach(mapAll);
  }
  hierarchy.forEach(mapAll);

  // For force-directed placement: cross-graph connections
  const graphPairWeights = {};

  function recordGraphPair(graphA, graphB) {
    const key = graphA < graphB
      ? `${graphA}\0${graphB}`
      : `${graphB}\0${graphA}`;
    graphPairWeights[key] = (graphPairWeights[key] || 0) + 1;
  }

  // For angular optimization: which rings each node's connections point toward
  const nodeNeighborRings = {};

  function recordNodeRing(nodeUri, targetRing) {
    if (!nodeNeighborRings[nodeUri]) nodeNeighborRings[nodeUri] = {};
    nodeNeighborRings[nodeUri][targetRing] =
      (nodeNeighborRings[nodeUri][targetRing] || 0) + 1;
  }

  function analyze(node) {
    const nodeGraph = node.graph_source || 'unknown';
    const nodeRing = effectiveRing[node.uri] || nodeGraph;

    // Property -> range connections
    if (node.properties) {
      for (const prop of node.properties) {
        for (const range of prop.ranges) {
          const rangeGraph = nodeGraphMap[range.uri];
          const rangeRing = effectiveRing[range.uri] || rangeGraph;

          // Force-directed: record cross-graph connections
          if (rangeGraph && rangeGraph !== nodeGraph) {
            recordGraphPair(nodeGraph, rangeGraph);
          }

          // Angular optimization: record cross-ring connections
          // (includes same-graph nodes displaced to another ring)
          // Record BOTH directions — the range node also connects back
          if (rangeRing && rangeRing !== nodeRing) {
            recordNodeRing(node.uri, rangeRing);
            recordNodeRing(range.uri, nodeRing);
          }
        }
      }
    }

    // Subclass connections
    if (node.children) {
      for (const child of node.children) {
        const childGraph = child.graph_source || 'unknown';
        const childRing = effectiveRing[child.uri] || childGraph;

        // Force-directed: cross-graph
        if (childGraph !== nodeGraph) {
          recordGraphPair(nodeGraph, childGraph);
        }

        // Angular optimization: cross-ring (both directions)
        if (childRing !== nodeRing) {
          recordNodeRing(node.uri, childRing);
          recordNodeRing(child.uri, nodeRing);
        }

        analyze(child);
      }
    }
  }

  hierarchy.forEach(analyze);
  return { nodeGraphMap, graphPairWeights, nodeNeighborRings };
}

// ── Ring footprint estimation ───────────────────────────────────

function maxSubtreeDepth(node) {
  if (!node.children || node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(maxSubtreeDepth));
}

/**
 * Estimate total radius of influence for a ring (ring radius + subtree extent).
 * Uses the max subtree depth since the deepest subtree determines how far
 * the ring extends toward neighboring rings.
 */
function estimateRingFootprint(roots) {
  if (!roots || roots.length === 0) return 100;
  const minSpacing = 150;
  const layerHeight = 120;
  const ringRadius = roots.length <= 1
    ? 0
    : (roots.length * minSpacing) / (2 * Math.PI);
  const depths = roots.map(maxSubtreeDepth);
  const maxDepth = Math.max(...depths, 0);
  return ringRadius + maxDepth * layerHeight + 60;
}

// ── Force-directed ring placement ───────────────────────────────

/**
 * Place ring centers using a force-directed simulation to find the best
 * relative arrangement, then rescale so rings are tightly packed with
 * just enough gap to avoid overlap.
 *
 * Phase 1 (topology): unit-strength forces find a good arrangement.
 * Phase 2 (rescale): normalize positions so the tightest pair of rings
 *   is separated by exactly footprintA + footprintB + padding.
 */
function forceDirectedRingPlacement(graphUris, graphPairWeights, graphFootprints) {
  const n = graphUris.length;
  if (n === 0) return {};
  if (n === 1) return { [graphUris[0]]: { x: 0, y: 0 } };

  // Parse edges
  const edges = [];
  for (const [key, weight] of Object.entries(graphPairWeights)) {
    const [a, b] = key.split('\0');
    if (graphUris.includes(a) && graphUris.includes(b)) {
      edges.push({ a, b, weight });
    }
  }

  // Initialize positions on a circle (unit scale — actual distances don't matter yet)
  const pos = {};
  graphUris.forEach((uri, i) => {
    const angle = (2 * Math.PI * i) / n;
    pos[uri] = { x: Math.cos(angle), y: Math.sin(angle) };
  });

  // ── Phase 1: force-directed simulation (unit-scale, topology only) ──
  const iterations = 300;
  let temperature = 1.0;
  const cooling = 0.97;
  // k = ideal unit spacing between nodes in the abstract layout
  const k = 1.0;

  for (let iter = 0; iter < iterations; iter++) {
    const forces = {};
    graphUris.forEach(uri => (forces[uri] = { x: 0, y: 0 }));

    // Repulsion between all pairs (Coulomb-like, unit strength)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = graphUris[i], b = graphUris[j];
        const dx = pos[a].x - pos[b].x;
        const dy = pos[a].y - pos[b].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;

        const force = (k * k) / dist;

        const fx = (force * dx) / dist;
        const fy = (force * dy) / dist;
        forces[a].x += fx;  forces[a].y += fy;
        forces[b].x -= fx;  forces[b].y -= fy;
      }
    }

    // Attraction along cross-ontology edges (spring, weighted)
    for (const { a, b, weight } of edges) {
      const dx = pos[b].x - pos[a].x;
      const dy = pos[b].y - pos[a].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;

      // Stronger attraction for heavier connections
      const force = (dist * dist) / k * (1 + Math.log(1 + weight));

      const fx = (force * dx) / dist;
      const fy = (force * dy) / dist;
      forces[a].x += fx;  forces[a].y += fy;
      forces[b].x -= fx;  forces[b].y -= fy;
    }

    // Weak gravity toward center
    graphUris.forEach(uri => {
      forces[uri].x -= pos[uri].x * 0.1;
      forces[uri].y -= pos[uri].y * 0.1;
    });

    // Apply forces capped by temperature
    graphUris.forEach(uri => {
      const fx = forces[uri].x, fy = forces[uri].y;
      const mag = Math.sqrt(fx * fx + fy * fy) || 1;
      const capped = Math.min(mag, temperature);
      pos[uri].x += (fx / mag) * capped;
      pos[uri].y += (fy / mag) * capped;
    });

    temperature *= cooling;
  }

  // ── Phase 2: place rings at correct pixel distances ──
  // Keep DIRECTIONS from force sim, but DISCARD distances.
  // Each ring's distance from center is computed from its footprint
  // plus edge-count-aware padding to its nearest neighbor.
  const basePadding = 100; // px base gap between ring edges
  const edgeSpacePerLink = 15; // extra px per cross-ring edge between a pair

  function pairKey(a, b) {
    return a < b ? `${a}\0${b}` : `${b}\0${a}`;
  }

  function requiredDist(a, b) {
    const edgeCount = graphPairWeights[pairKey(a, b)] || 0;
    return (graphFootprints[a] || 200) + (graphFootprints[b] || 200) + basePadding + edgeCount * edgeSpacePerLink;
  }

  // Center at origin, then normalize all rings to unit direction vectors
  let cx = 0, cy = 0;
  graphUris.forEach(uri => { cx += pos[uri].x; cy += pos[uri].y; });
  cx /= n; cy /= n;

  const directions = {};
  graphUris.forEach(uri => {
    const dx = pos[uri].x - cx;
    const dy = pos[uri].y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
    directions[uri] = { x: dx / dist, y: dy / dist };
  });

  // Place rings iteratively: start from the most connected ring (center),
  // then place each subsequent ring at the correct distance from already-placed rings.
  // The most connected ring goes at (0,0).
  const totalConnections = {};
  graphUris.forEach(uri => {
    let total = 0;
    for (const [key, weight] of Object.entries(graphPairWeights)) {
      if (key.includes(uri)) total += weight;
    }
    totalConnections[uri] = total;
  });

  const placementOrder = [...graphUris].sort((a, b) => totalConnections[b] - totalConnections[a]);

  const placed = new Set();
  const finalPos = {};

  // Most connected ring at center
  finalPos[placementOrder[0]] = { x: 0, y: 0 };
  placed.add(placementOrder[0]);

  // Place remaining rings along their force-sim direction, at the distance
  // required by their nearest already-placed neighbor
  for (let i = 1; i < placementOrder.length; i++) {
    const uri = placementOrder[i];
    const dir = directions[uri];

    // Find the required distance to the nearest placed neighbor
    let nearestDist = Infinity;
    for (const placedUri of placed) {
      const req = requiredDist(uri, placedUri);
      // Project: how far along our direction is this placed ring?
      // Use actual required distance to the closest placed ring
      const pdx = finalPos[placedUri].x;
      const pdy = finalPos[placedUri].y;
      const distFromCenter = Math.sqrt(pdx * pdx + pdy * pdy);
      const totalNeeded = distFromCenter + req;
      if (totalNeeded < nearestDist) nearestDist = totalNeeded;
    }

    // Place along the direction from the force sim
    finalPos[uri] = {
      x: dir.x * nearestDist,
      y: dir.y * nearestDist
    };
    placed.add(uri);
  }

  // Recenter
  cx = 0; cy = 0;
  graphUris.forEach(uri => { cx += finalPos[uri].x; cy += finalPos[uri].y; });
  cx /= n; cy /= n;
  graphUris.forEach(uri => {
    pos[uri].x = finalPos[uri].x - cx;
    pos[uri].y = finalPos[uri].y - cy;
  });

  // Safety: push apart any overlapping pairs
  for (let iter = 0; iter < 20; iter++) {
    let anyPushed = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = graphUris[i], b = graphUris[j];
        const dx = pos[a].x - pos[b].x;
        const dy = pos[a].y - pos[b].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minDist = requiredDist(a, b);
        if (dist < minDist) {
          const push = (minDist - dist) / 2;
          const ux = dx / dist, uy = dy / dist;
          pos[a].x += ux * push;  pos[a].y += uy * push;
          pos[b].x -= ux * push;  pos[b].y -= uy * push;
          anyPushed = true;
        }
      }
    }
    if (!anyPushed) break;
  }

  return pos;
}

// ── Angular optimization of roots within each ring ──────────────

/**
 * Compute the optimal circular ordering of roots within a ring.
 * Roots whose subtrees have cross-ontology connections are placed
 * at angular positions pointing toward the connected neighbor rings.
 * Unconstrained roots fill the largest remaining gaps.
 */
/**
 * Returns { orderedRoots, startAngle } so calculateRingLayout can
 * rotate the ring to align roots with their ideal directions.
 */
function computeOptimalRootOrder(roots, graphUri, ringCenter, allRingCenters, nodeNeighborRings) {
  if (roots.length <= 1) return { orderedRoots: roots, startAngle: -(Math.PI / 2) };

  // Collect cross-ring connection weights for an entire subtree.
  // Uses nodeNeighborRings which accounts for displaced nodes
  // (e.g. a Purple node living in Green's ring counts as pointing toward Green).
  function subtreeNeighborWeights(root) {
    const weights = {};
    function walk(node) {
      const conns = nodeNeighborRings[node.uri];
      if (conns) {
        for (const [ng, w] of Object.entries(conns)) {
          weights[ng] = (weights[ng] || 0) + w;
        }
      }
      if (node.children) node.children.forEach(walk);
    }
    walk(root);
    return weights;
  }

  // Compute ideal angle for each root via weighted centroid
  const annotated = roots.map(root => {
    const nw = subtreeNeighborWeights(root);
    let wx = 0, wy = 0;
    for (const [ng, weight] of Object.entries(nw)) {
      const nc = allRingCenters[ng];
      if (nc) {
        const dx = nc.x - ringCenter.x;
        const dy = nc.y - ringCenter.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        wx += weight * dx / d;
        wy += weight * dy / d;
      } else {
        console.warn(`[angular] root "${root.label}": neighbor ring "${ng}" not found in allRingCenters`);
      }
    }
    const isConstrained = wx !== 0 || wy !== 0;
    const idealAngle = isConstrained ? Math.atan2(wy, wx) : null;
    const nwKeys = Object.keys(nw);
    if (nwKeys.length > 0) {
      console.log(`[angular] ring="${graphUri}" root="${root.label}" neighbors=${JSON.stringify(nw)} idealAngle=${idealAngle !== null ? (idealAngle * 180 / Math.PI).toFixed(1) + '°' : 'none'} constrained=${isConstrained}`);
    }
    return { root, idealAngle, constrained: isConstrained };
  });

  const constrained = annotated
    .filter(a => a.constrained)
    .sort((a, b) => a.idealAngle - b.idealAngle);
  const unconstrained = annotated.filter(a => !a.constrained);

  console.log(`[angular] ring="${graphUri}": ${constrained.length} constrained, ${unconstrained.length} unconstrained of ${roots.length} roots`);

  // No cross-links at all — keep original order, default start at top
  if (constrained.length === 0) {
    return { orderedRoots: roots, startAngle: -(Math.PI / 2) };
  }

  // ── Build intra-ring affinity between roots ──
  // Count how many edges connect subtrees of each pair of roots in this ring.
  const nodeToRoot = {};
  function markSubtree(node, rootUri) {
    nodeToRoot[node.uri] = rootUri;
    if (node.children) node.children.forEach(child => markSubtree(child, rootUri));
  }
  roots.forEach(root => markSubtree(root, root.uri));

  const intraAffinity = {}; // "rootA\0rootB" (sorted) -> count
  function addAffinity(a, b) {
    const key = a < b ? `${a}\0${b}` : `${b}\0${a}`;
    intraAffinity[key] = (intraAffinity[key] || 0) + 1;
  }
  function scanForAffinity(node) {
    const myRoot = nodeToRoot[node.uri];
    if (node.properties) {
      for (const prop of node.properties) {
        for (const range of prop.ranges) {
          const otherRoot = nodeToRoot[range.uri];
          if (otherRoot && otherRoot !== myRoot) addAffinity(myRoot, otherRoot);
        }
      }
    }
    if (node.children) node.children.forEach(scanForAffinity);
  }
  roots.forEach(scanForAffinity);

  function getAffinity(a, b) {
    const key = a < b ? `${a}\0${b}` : `${b}\0${a}`;
    return intraAffinity[key] || 0;
  }

  // ── Slot assignment: constrained roots first, then fill ──
  // N evenly-spaced slots on a clock face, slot 0 at top (-π/2).
  // Constrained roots claim nearest available slot (strongest first).
  // Unconstrained roots fill whatever slots remain.

  const N = roots.length;
  const angleStep = (2 * Math.PI) / N;
  const startAngle = -(Math.PI / 2);

  // Slot angles: fixed clock face
  const slotAngles = [];
  for (let s = 0; s < N; s++) {
    slotAngles.push(startAngle + s * angleStep);
  }

  // Helper: angular distance (unsigned, 0 to π)
  function angDist(a, b) {
    let d = Math.abs(a - b) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d;
  }

  const slotContents = new Array(N).fill(null);

  // Constrained roots claim slots — strongest-connected get first pick
  const ranked = [...constrained].sort((a, b) => {
    const wa = Object.values(subtreeNeighborWeights(a.root)).reduce((s, w) => s + w, 0);
    const wb = Object.values(subtreeNeighborWeights(b.root)).reduce((s, w) => s + w, 0);
    return wb - wa;
  });

  for (const c of ranked) {
    let bestSlot = -1, bestDist = Infinity;
    for (let s = 0; s < N; s++) {
      if (slotContents[s]) continue;
      const dist = angDist(slotAngles[s], c.idealAngle);
      if (dist < bestDist) {
        bestDist = dist;
        bestSlot = s;
      }
    }
    if (bestSlot >= 0) {
      slotContents[bestSlot] = c.root;
      console.log(`[angular] "${c.root.label}" → slot ${bestSlot} at ${(slotAngles[bestSlot] * 180 / Math.PI).toFixed(0)}° (ideal=${(c.idealAngle * 180 / Math.PI).toFixed(0)}°, err=${(bestDist * 180 / Math.PI).toFixed(0)}°)`);
    }
  }

  // Unconstrained roots fill remaining slots
  const unconstrainedRoots = unconstrained.map(u => u.root);
  let uIdx = 0;
  for (let s = 0; s < N && uIdx < unconstrainedRoots.length; s++) {
    if (!slotContents[s]) {
      slotContents[s] = unconstrainedRoots[uIdx++];
    }
  }

  // Build ordered list from slots
  const ordered = [];
  for (let s = 0; s < N; s++) {
    if (slotContents[s]) ordered.push(slotContents[s]);
  }

  console.log(`[angular] ring="${graphUri}" order: ${ordered.map(r => r.label).join(' → ')}`);

  return { orderedRoots: ordered, startAngle };
}

// ── Main layout entry point ─────────────────────────────────────

/**
 * Calculate positions for multiple rings with force-directed placement
 * and angular optimization of roots within each ring.
 * @param {Array} hierarchy - Array of root nodes with graph source info
 * @param {Object} graphNodes - Object mapping graph URIs to their class nodes
 * @returns {Object} Layout positions keyed by node URI
 */
export function calculateRingMatrixLayout(hierarchy, graphNodes) {
  const layout = {};
  const graphUris = Object.keys(graphNodes);
  if (graphUris.length === 0) return layout;

  // 1. Build effective-ring map (which ring each node actually lives in)
  const effectiveRing = buildEffectiveRingMap(hierarchy);

  // 2. Analyze connections (graph-pair weights for force-directed,
  //    node-neighbor-rings for angular optimization)
  const { nodeGraphMap, graphPairWeights, nodeNeighborRings } =
    analyzeCrossOntologyConnections(hierarchy, effectiveRing);

  // 3. Estimate footprint radius for each ring
  const footprints = {};
  for (const uri of graphUris) {
    footprints[uri] = estimateRingFootprint(graphNodes[uri] || []);
  }

  // 4. Force-directed placement of ring centers
  const ringCenters = forceDirectedRingPlacement(
    graphUris, graphPairWeights, footprints
  );

  // 5. For each ring, compute optimal root ordering and layout
  for (const graphUri of graphUris) {
    const roots = graphNodes[graphUri];
    if (!roots || roots.length === 0) continue;

    const center = ringCenters[graphUri] || { x: 0, y: 0 };

    const { orderedRoots, startAngle } = computeOptimalRootOrder(
      roots, graphUri, center, ringCenters, nodeNeighborRings
    );

    const ringLayout = calculateRingLayout(orderedRoots, center.x, center.y, startAngle);
    Object.assign(layout, ringLayout);
  }

  return layout;
}

// ── Single-ring layout ──────────────────────────────────────────

/**
 * Calculate layout for a single ring at a specific center position
 * @param {Array} hierarchy - Array of root nodes for this ring
 * @param {number} centerX - X center of the ring
 * @param {number} centerY - Y center of the ring
 * @param {number} [startAngle] - Starting angle for first root (default: -π/2 = top)
 * @returns {Object} Positions for all nodes in this ring
 */
export function calculateRingLayout(hierarchy, centerX, centerY, startAngle) {
  const layout = {};

  if (!hierarchy || hierarchy.length === 0) return layout;

  if (startAngle === undefined) startAngle = -(Math.PI / 2);

  // Calculate radius based on spacing - let small rings be small
  const minSpacing = 150;
  const calculatedRadius = (hierarchy.length * minSpacing) / (2 * Math.PI);
  const ringRadius = calculatedRadius;

  // Calculate positions for each root around the circle
  const angleStep = (2 * Math.PI) / hierarchy.length;

  hierarchy.forEach((rootNode, index) => {
    const angle = startAngle + index * angleStep;
    const rootX = centerX + ringRadius * Math.cos(angle);
    const rootY = centerY + ringRadius * Math.sin(angle);

    // Calculate tree layout in concentric rings around the ring center
    const treeLayout = calculateTreeLayout(rootNode, rootX, rootY, angle, centerX, centerY, ringRadius);
    Object.assign(layout, treeLayout);
  });

  return layout;
}

// ── Single-tree layout (concentric rings outward from root) ─────

/**
 * Calculate layout for a single tree growing outward in concentric rings.
 * Each depth level lives on a ring at radius = ringRadius + depth * layerHeight.
 * Children are centered around their parent's angular position.
 *
 * @param {Object} rootNode - The root node of the tree
 * @param {number} rootX - X position of the root
 * @param {number} rootY - Y position of the root
 * @param {number} rootAngle - Angle of the root on the ring (radians)
 * @param {number} ringCenterX - X center of the ontology ring
 * @param {number} ringCenterY - Y center of the ontology ring
 * @param {number} ringRadius - Radius of the root ring
 * @returns {Object} Positions for all nodes in this tree
 */
function calculateTreeLayout(rootNode, rootX, rootY, rootAngle, ringCenterX, ringCenterY, ringRadius) {
  const positions = {};
  const layerHeight = 180;

  // Angular width of one node at a given radius (keeps visual spacing consistent)
  const nodeArcWidth = 150; // px of arc per leaf node

  // First pass: calculate subtree widths (in leaf units)
  function calculateSubtreeWidth(node) {
    if (!node.children || node.children.length === 0) {
      return 1;
    }
    return node.children.reduce((total, child) => total + calculateSubtreeWidth(child), 0);
  }

  // Second pass: assign positions on concentric rings
  // Each node gets an angular span; its children divide that span proportionally.
  function assignPositions(node, centerAngle, depth) {
    const radius = ringRadius + depth * layerHeight;
    positions[node.uri] = {
      x: ringCenterX + radius * Math.cos(centerAngle),
      y: ringCenterY + radius * Math.sin(centerAngle)
    };

    if (node.children && node.children.length > 0) {
      const childRadius = ringRadius + (depth + 1) * layerHeight;
      const totalChildWidth = node.children.reduce((t, c) => t + calculateSubtreeWidth(c), 0);

      // Angular span needed for children at their radius
      const totalArc = totalChildWidth * nodeArcWidth / childRadius;

      // Center the children's span on the parent's angle
      let currentAngle = centerAngle - totalArc / 2;

      node.children.forEach(child => {
        const childWidth = calculateSubtreeWidth(child);
        const childArc = childWidth * nodeArcWidth / childRadius;
        const childAngle = currentAngle + childArc / 2;

        assignPositions(child, childAngle, depth + 1);

        currentAngle += childArc;
      });
    }
  }

  assignPositions(rootNode, rootAngle, 0);

  return positions;
}

// ── Graph grouping utilities ────────────────────────────────────

/**
 * Group hierarchy nodes by their source graph
 * @param {Array} hierarchy - Array of root nodes with graph_source info
 * @returns {Object} Object mapping graph URIs to their hierarchy nodes
 */
export function groupNodesByGraph(hierarchy) {
  const graphNodes = {};

  function collectNodesByGraph(node) {
    const graphUri = node.graph_source || 'unknown';

    if (!graphNodes[graphUri]) {
      graphNodes[graphUri] = [];
    }

    // Check if this is a root node for this graph
    const isRoot = !hierarchy.some(root =>
      root !== node && hasNodeInChildren(root, node.uri)
    );

    if (isRoot) {
      graphNodes[graphUri].push(node);
    }

    // Recursively process children
    if (node.children) {
      node.children.forEach(child => collectNodesByGraph(child));
    }
  }

  // Collect all nodes by graph
  hierarchy.forEach(root => collectNodesByGraph(root));

  return graphNodes;
}

/**
 * Check if a node URI exists in the children tree
 * @param {Object} parentNode - Parent node to search in
 * @param {string} targetUri - URI to search for
 * @returns {boolean} True if found in children
 */
function hasNodeInChildren(parentNode, targetUri) {
  if (!parentNode.children) return false;

  for (const child of parentNode.children) {
    if (child.uri === targetUri) return true;
    if (hasNodeInChildren(child, targetUri)) return true;
  }

  return false;
}
