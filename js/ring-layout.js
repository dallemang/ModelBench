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
 * Estimate total radius of influence for a ring (ring radius + average subtree extent).
 * Uses average depth rather than max, since subtrees radiate outward in different
 * directions and only one points in any given direction.
 */
function estimateRingFootprint(roots) {
  if (!roots || roots.length === 0) return 100;
  const minSpacing = 150;
  const layerHeight = 120;
  const ringRadius = roots.length <= 1
    ? 0
    : (roots.length * minSpacing) / (2 * Math.PI);
  const depths = roots.map(maxSubtreeDepth);
  const avgDepth = depths.reduce((sum, d) => sum + d, 0) / depths.length;
  return ringRadius + avgDepth * layerHeight + 60;
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

  // ── Phase 2: rescale to real pixel coordinates ──
  // For every pair, compute the ratio of actual distance to required distance.
  // The tightest pair (smallest ratio) determines the global scale factor.
  const padding = 100; // px gap between ring edges
  let minRatio = Infinity;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = graphUris[i], b = graphUris[j];
      const dx = pos[a].x - pos[b].x;
      const dy = pos[a].y - pos[b].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;

      const requiredDist =
        (graphFootprints[a] || 200) + (graphFootprints[b] || 200) + padding;
      const ratio = dist / requiredDist;
      if (ratio < minRatio) minRatio = ratio;
    }
  }

  // Scale so the tightest pair just fits
  const scale = minRatio > 0 ? 1 / minRatio : 1;

  // Center the layout at origin and apply scale
  let cx = 0, cy = 0;
  graphUris.forEach(uri => { cx += pos[uri].x; cy += pos[uri].y; });
  cx /= n; cy /= n;

  graphUris.forEach(uri => {
    pos[uri].x = (pos[uri].x - cx) * scale;
    pos[uri].y = (pos[uri].y - cy) * scale;
  });

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

  // ── Angle-based ordering with greedy affinity placement ──
  // Constrained roots get their ideal angles as sort keys.
  // Unconstrained roots with intra-ring affinity get angles nudged
  // right next to their strongest connection (epsilon offset ensures adjacency).
  // Isolated roots go in the largest gap.
  // Final layout is EVENLY SPACED — angles only determine ORDER.

  const placed = new Map(); // rootUri -> sortAngle
  for (const c of constrained) {
    placed.set(c.root.uri, c.idealAngle);
  }

  function findLargestGapMidpoint() {
    const angles = [...placed.values()].sort((a, b) => a - b);
    if (angles.length === 0) return 0;
    if (angles.length === 1) return angles[0] + Math.PI;
    let maxGap = 0, maxMid = 0;
    for (let i = 0; i < angles.length; i++) {
      const next = (i + 1) % angles.length;
      let gap = angles[next] - angles[i];
      if (gap <= 0) gap += 2 * Math.PI;
      if (gap > maxGap) {
        maxGap = gap;
        maxMid = angles[i] + gap / 2;
      }
    }
    return maxMid;
  }

  const allAssigned = constrained.map(c => ({ root: c.root, angle: c.idealAngle, constrained: true }));
  const remaining = unconstrained.map(u => u.root);

  // Tiny epsilon to ensure affinity roots sort right after their connection
  const eps = 0.0001;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestStrength = -1;
    let bestAngle = null;
    let bestNeighborUri = null;

    for (let i = 0; i < remaining.length; i++) {
      const root = remaining[i];
      let maxW = 0, maxNeighborUri = null;

      for (const [placedUri, placedAngle] of placed) {
        const w = getAffinity(root.uri, placedUri);
        if (w > maxW) {
          maxW = w;
          maxNeighborUri = placedUri;
        }
      }

      if (maxW > bestStrength) {
        bestStrength = maxW;
        bestIdx = i;
        bestNeighborUri = maxNeighborUri;
        bestAngle = maxW > 0 ? placed.get(maxNeighborUri) + eps : null;
      }
    }

    const root = remaining[bestIdx];
    remaining.splice(bestIdx, 1);

    if (bestAngle === null) {
      bestAngle = findLargestGapMidpoint();
    }

    placed.set(root.uri, bestAngle);
    allAssigned.push({ root, angle: bestAngle, constrained: false });
    if (bestStrength > 0) {
      console.log(`[angular] placed "${root.label}" next to "${roots.find(r => r.uri === bestNeighborUri)?.label}" (affinity=${bestStrength})`);
    } else {
      console.log(`[angular] placed isolated "${root.label}" in largest gap`);
    }
  }

  // Sort all roots by their assigned angle (determines ORDER only)
  allAssigned.sort((a, b) => a.angle - b.angle);

  const ordered = allAssigned.map(a => a.root);

  // Compute startAngle from constrained roots' positions in the sorted order
  const angleStep = (2 * Math.PI) / ordered.length;
  const constrainedPositions = [];
  allAssigned.forEach((a, idx) => {
    if (a.constrained) {
      constrainedPositions.push({ index: idx, idealAngle: a.angle });
    }
  });

  let sumOffset = 0;
  for (const { index, idealAngle } of constrainedPositions) {
    let offset = idealAngle - index * angleStep;
    offset = ((offset + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    sumOffset += offset;
  }
  const startAngle = sumOffset / constrainedPositions.length;

  // Diagnostic
  console.log(`[angular] ring="${graphUri}" startAngle=${(startAngle * 180 / Math.PI).toFixed(1)}°`);
  console.log(`[angular] ring="${graphUri}" order: ${ordered.map(r => r.label).join(' → ')}`);
  for (const { index, idealAngle } of constrainedPositions) {
    const actualAngle = startAngle + index * angleStep;
    const root = ordered[index];
    const error = idealAngle - actualAngle;
    console.log(`[angular]   "${root.label}" pos=${index}/${ordered.length} ideal=${(idealAngle * 180 / Math.PI).toFixed(1)}° actual=${(actualAngle * 180 / Math.PI).toFixed(1)}° error=${(error * 180 / Math.PI).toFixed(1)}°`);
  }

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

    // Calculate tree layout with root at this position
    const treeLayout = calculateTreeLayout(rootNode, rootX, rootY, angle);
    Object.assign(layout, treeLayout);
  });

  return layout;
}

// ── Single-tree layout (radial outward from root) ───────────────

/**
 * Calculate layout for a single tree growing outward from a root position
 * @param {Object} rootNode - The root node of the tree
 * @param {number} rootX - X position of the root
 * @param {number} rootY - Y position of the root
 * @param {number} angle - Angle from center for outward growth direction
 * @returns {Object} Positions for all nodes in this tree
 */
function calculateTreeLayout(rootNode, rootX, rootY, angle) {
  const positions = {};
  const nodeWidth = 150;
  const layerHeight = 120;

  // Calculate direction vector - trees grow AWAY from center (outward)
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);

  // Calculate perpendicular vector for horizontal spreading of children
  const perpX = -directionY;
  const perpY = directionX;

  // First pass: calculate subtree widths
  function calculateSubtreeWidth(node) {
    if (!node.children || node.children.length === 0) {
      return 1;
    }

    const childrenWidth = node.children.reduce((total, child) => {
      return total + calculateSubtreeWidth(child);
    }, 0);

    return Math.max(1, childrenWidth);
  }

  // Second pass: assign positions based on subtree widths
  function assignPositions(node, centerX, centerY, level, availableWidth) {
    positions[node.uri] = { x: centerX, y: centerY };

    if (node.children && node.children.length > 0) {
      const childLevel = level + 1;
      const childCenterX = centerX + directionX * layerHeight;
      const childCenterY = centerY + directionY * layerHeight;

      const totalChildWidth = node.children.reduce((total, child) => {
        return total + calculateSubtreeWidth(child);
      }, 0);

      const startOffset = (totalChildWidth - 1) * nodeWidth / 2;
      let currentOffset = -startOffset;

      node.children.forEach(child => {
        const childSubtreeWidth = calculateSubtreeWidth(child);
        const childOffset = currentOffset + (childSubtreeWidth - 1) * nodeWidth / 2;

        const childX = childCenterX + perpX * childOffset;
        const childY = childCenterY + perpY * childOffset;

        assignPositions(child, childX, childY, childLevel, childSubtreeWidth);

        currentOffset += childSubtreeWidth * nodeWidth;
      });
    }
  }

  // Start positioning from the root
  const rootSubtreeWidth = calculateSubtreeWidth(rootNode);
  assignPositions(rootNode, rootX, rootY, 0, rootSubtreeWidth);

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
