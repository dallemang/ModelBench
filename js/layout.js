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