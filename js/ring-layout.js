/**
 * Ring-based layout for multiple graphs - each graph gets its own ring
 */

import { calculateHierarchicalLayout } from './layout.js';

/**
 * Calculate positions for multiple rings arranged in a matrix
 * @param {Array} hierarchy - Array of root nodes with graph source info
 * @param {Object} graphNodes - Object mapping graph URIs to their class nodes
 * @returns {Object} Layout positions keyed by node URI
 */
export function calculateRingMatrixLayout(hierarchy, graphNodes) {
  const layout = {};
  
  // Get list of unique graphs
  const graphUris = Object.keys(graphNodes);
  const numGraphs = graphUris.length;
  
  if (numGraphs === 0) return layout;
  
  // Calculate matrix dimensions (as square as possible)
  const matrixCols = Math.ceil(Math.sqrt(numGraphs));
  const matrixRows = Math.ceil(numGraphs / matrixCols);
  
  // Ring spacing parameters
  const ringSpacing = 800;  // Distance between ring centers
  const baseRingRadius = 200; // Base radius for individual rings
  
  // Calculate matrix center offset
  const matrixWidth = (matrixCols - 1) * ringSpacing;
  const matrixHeight = (matrixRows - 1) * ringSpacing;
  const matrixCenterX = -matrixWidth / 2;
  const matrixCenterY = -matrixHeight / 2;
  
  // Layout each graph in its own ring
  graphUris.forEach((graphUri, index) => {
    // Calculate matrix position for this ring
    const col = index % matrixCols;
    const row = Math.floor(index / matrixCols);
    
    const ringCenterX = matrixCenterX + col * ringSpacing;
    const ringCenterY = matrixCenterY + row * ringSpacing;
    
    // Get the hierarchy for this specific graph
    const graphHierarchy = graphNodes[graphUri];
    
    if (graphHierarchy && graphHierarchy.length > 0) {
      // Calculate layout for this ring using existing algorithm
      const ringLayout = calculateRingLayout(graphHierarchy, ringCenterX, ringCenterY, baseRingRadius);
      Object.assign(layout, ringLayout);
    }
  });
  
  return layout;
}

/**
 * Calculate layout for a single ring at a specific center position
 * @param {Array} hierarchy - Array of root nodes for this ring
 * @param {number} centerX - X center of the ring
 * @param {number} centerY - Y center of the ring  
 * @param {number} baseRadius - Base radius for the ring
 * @returns {Object} Positions for all nodes in this ring
 */
export function calculateRingLayout(hierarchy, centerX, centerY, baseRadius) {
  const layout = {};
  
  if (!hierarchy || hierarchy.length === 0) return layout;
  
  // Calculate radius based on spacing - let small rings be small
  const minSpacing = 150;
  const calculatedRadius = (hierarchy.length * minSpacing) / (2 * Math.PI);
  const ringRadius = calculatedRadius;
  
  // Calculate positions for each root around the circle
  const angleStep = (2 * Math.PI) / hierarchy.length;
  
  hierarchy.forEach((rootNode, index) => {
    // Calculate root position on the circle
    const angle = index * angleStep - (Math.PI / 2); // Start at top
    const rootX = centerX + ringRadius * Math.cos(angle);
    const rootY = centerY + ringRadius * Math.sin(angle);
    
    // Calculate tree layout with root at this position
    const treeLayout = calculateTreeLayout(rootNode, rootX, rootY, angle);
    Object.assign(layout, treeLayout);
  });
  
  return layout;
}

/**
 * Calculate layout for a single tree growing outward from a root position
 * This is similar to the existing calculateTreeLayout but isolated for rings
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