/**
 * Custom layout algorithms for hierarchical class diagrams
 */

/**
 * Calculate custom hierarchical layout positions for a circular radial design
 * @param {Array} hierarchy - Array of root nodes with their hierarchical structure
 * @returns {Object} Layout positions keyed by node URI
 */
export function calculateHierarchicalLayout(hierarchy) {
  const layout = {};
  const nodeWidth = 100;     // Width of a node (for spacing calculations)
  const minSpacing = 150;    // Minimum distance between adjacent roots
  
  // Calculate minimum radius needed to prevent root overlap
  // Circumference needed = numRoots * minSpacing
  // Radius = Circumference / (2 * π)
  const minRadius = (hierarchy.length * minSpacing) / (2 * Math.PI);
  const circleRadius = Math.max(120, minRadius); // At least 120px radius
  
  const centerX = 0;         // Center of the circle
  const centerY = 0;         // Center of the circle
  
  // Calculate positions for each root around the circle
  const angleStep = (2 * Math.PI) / hierarchy.length;
  
  hierarchy.forEach((rootNode, index) => {
    // Calculate root position on the circle
    const angle = index * angleStep - (Math.PI / 2); // Start at top (subtract π/2)
    const rootX = centerX + circleRadius * Math.cos(angle);
    const rootY = centerY + circleRadius * Math.sin(angle);
    
    // Calculate tree layout with root at this position
    const treeLayout = calculateTreeLayout(rootNode, rootX, rootY, angle);
    Object.assign(layout, treeLayout);
  });
  
  return layout;
}

/**
 * Post-process layout to reposition orphaned nodes near their connected nodes
 * @param {Object} layout - Current layout positions keyed by node URI
 * @param {Array} edges - Array of edge objects with source/target data
 * @param {Array} nodes - Array of node objects with category data
 * @returns {Object} Updated layout positions
 */
export function repositionOrphansNearConnections(layout, edges, nodes) {
  // Find orphaned nodes (foster orphans with graph_source="property_range")
  const orphanNodes = nodes.filter(node => 
    node.data.graph_source === 'property_range' || 
    node.data.category === 'orphaned'
  );
  
  if (orphanNodes.length === 0) return layout;
  
  const updatedLayout = { ...layout };
  
  orphanNodes.forEach(orphanNode => {
    const orphanUri = orphanNode.data.id;
    
    // Find all edges connected to this orphan
    const connectedEdges = edges.filter(edge => 
      edge.data.source === orphanUri || edge.data.target === orphanUri
    );
    
    // Get the URIs of connected nodes (excluding the orphan itself)
    const connectedNodeUris = connectedEdges.flatMap(edge => [
      edge.data.source, edge.data.target
    ]).filter(uri => uri !== orphanUri);
    
    // If orphan has any connections, reposition it near the average position
    if (connectedNodeUris.length > 0) {
      // Get positions of all connected nodes
      const connectedPositions = connectedNodeUris
        .map(uri => updatedLayout[uri])
        .filter(pos => pos !== undefined);
      
      if (connectedPositions.length > 0) {
        // Calculate average position of all connected nodes
        const averagePos = {
          x: connectedPositions.reduce((sum, pos) => sum + pos.x, 0) / connectedPositions.length,
          y: connectedPositions.reduce((sum, pos) => sum + pos.y, 0) / connectedPositions.length
        };
        
        // Find a good position near the average position
        const newPos = findAvailablePositionNear(
          averagePos, 
          updatedLayout, 
          orphanUri
        );
        updatedLayout[orphanUri] = newPos;
      }
    }
  });
  
  // Post-process: spread out orphans that are too close to each other
  spreadOrphansApart(updatedLayout, orphanNodes);
  
  return updatedLayout;
}

/**
 * Find an available position near a target position, avoiding collisions
 * @param {Object} targetPos - Target position {x, y}
 * @param {Object} layout - Current layout positions
 * @param {string} excludeUri - URI to exclude from collision checking
 * @returns {Object} Available position {x, y}
 */
function findAvailablePositionNear(targetPos, layout, excludeUri) {
  const nodeWidth = 120;
  const nodeHeight = 40;
  const minDistance = 160; // Minimum distance between node centers
  
  // Try positions in a spiral pattern around the target
  const attempts = [
    { x: minDistance, y: 0 },           // Right
    { x: -minDistance, y: 0 },          // Left  
    { x: 0, y: minDistance },           // Below
    { x: 0, y: -minDistance },          // Above
    { x: minDistance, y: minDistance }, // Bottom-right
    { x: -minDistance, y: minDistance }, // Bottom-left
    { x: minDistance, y: -minDistance }, // Top-right
    { x: -minDistance, y: -minDistance }, // Top-left
    { x: minDistance * 1.5, y: 0 },     // Further right
    { x: -minDistance * 1.5, y: 0 },    // Further left
    { x: 0, y: minDistance * 1.5 },     // Further below
    { x: 0, y: -minDistance * 1.5 }     // Further above
  ];
  
  for (const offset of attempts) {
    const candidatePos = {
      x: targetPos.x + offset.x,
      y: targetPos.y + offset.y
    };
    
    // Check if this position collides with any existing nodes
    const hasCollision = Object.entries(layout).some(([uri, pos]) => {
      if (uri === excludeUri) return false;
      
      const distance = Math.sqrt(
        Math.pow(candidatePos.x - pos.x, 2) + 
        Math.pow(candidatePos.y - pos.y, 2)
      );
      
      return distance < minDistance;
    });
    
    if (!hasCollision) {
      return candidatePos;
    }
  }
  
  // If all positions are taken, use the first one anyway (right side)
  return {
    x: targetPos.x + minDistance,
    y: targetPos.y
  };
}

/**
 * Calculate layout for a single tree growing outward from a root position
 * @param {Object} rootNode - The root node of the tree
 * @param {number} rootX - X position of the root
 * @param {number} rootY - Y position of the root  
 * @param {number} angle - Angle from center for outward growth direction
 * @returns {Object} Positions for all nodes in this tree
 */
export function calculateTreeLayout(rootNode, rootX, rootY, angle) {
  const positions = {};
  const nodeWidth = 150;
  const layerHeight = 120;
  
  // Calculate direction vector - trees grow AWAY from center (outward)
  const directionX = Math.cos(angle); // Away from center
  const directionY = Math.sin(angle); // Away from center
  
  // Calculate perpendicular vector for horizontal spreading of children
  const perpX = -directionY; // Perpendicular to direction
  const perpY = directionX;
  
  // First pass: calculate subtree widths (how much horizontal space each subtree needs)
  function calculateSubtreeWidth(node) {
    if (!node.children || node.children.length === 0) {
      return 1; // Leaf node takes one unit width
    }
    
    // Sum up the widths of all children subtrees
    const childrenWidth = node.children.reduce((total, child) => {
      return total + calculateSubtreeWidth(child);
    }, 0);
    
    return Math.max(1, childrenWidth); // At least one unit width, or sum of children
  }
  
  // Second pass: assign positions based on subtree widths
  function assignPositions(node, centerX, centerY, level, availableWidth) {
    // Position this node at its center
    positions[node.uri] = { x: centerX, y: centerY };
    
    if (node.children && node.children.length > 0) {
      // Calculate positions for children
      const childLevel = level + 1;
      const childCenterX = centerX + directionX * layerHeight;
      const childCenterY = centerY + directionY * layerHeight;
      
      // Calculate total width needed for all children
      const totalChildWidth = node.children.reduce((total, child) => {
        return total + calculateSubtreeWidth(child);
      }, 0);
      
      // Start position for children (leftmost)
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

/**
 * Spread orphaned nodes apart if they're too close to each other
 * @param {Object} layout - Layout positions keyed by node URI
 * @param {Array} orphanNodes - Array of orphan node objects
 */
function spreadOrphansApart(layout, orphanNodes) {
  const minOrphanDistance = 160; // Minimum distance between orphan centers
  const maxIterations = 5; // Prevent infinite loops
  
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let moved = false;
    
    // Check each pair of orphans
    for (let i = 0; i < orphanNodes.length; i++) {
      for (let j = i + 1; j < orphanNodes.length; j++) {
        const orphan1Uri = orphanNodes[i].data.id;
        const orphan2Uri = orphanNodes[j].data.id;
        
        const pos1 = layout[orphan1Uri];
        const pos2 = layout[orphan2Uri];
        
        if (!pos1 || !pos2) continue;
        
        // Calculate distance between orphans
        const dx = pos2.x - pos1.x;
        const dy = pos2.y - pos1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // If they're too close, push them apart
        if (distance < minOrphanDistance && distance > 0) {
          // Calculate push direction (unit vector)
          const pushX = dx / distance;
          const pushY = dy / distance;
          
          // Calculate how much to move each node (half the needed separation)
          const pushDistance = (minOrphanDistance - distance) / 2;
          
          // Move orphan2 away from orphan1
          layout[orphan2Uri] = {
            x: pos2.x + pushX * pushDistance,
            y: pos2.y + pushY * pushDistance
          };
          
          // Move orphan1 away from orphan2
          layout[orphan1Uri] = {
            x: pos1.x - pushX * pushDistance,
            y: pos1.y - pushY * pushDistance
          };
          
          moved = true;
        }
      }
    }
    
    // If no orphans were moved in this iteration, we're done
    if (!moved) break;
  }
}