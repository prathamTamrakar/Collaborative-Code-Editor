export interface Identifier {
  counter: number;
  clientId: string;
}

export class RGANode {
  id: Identifier;
  originId: Identifier | null;
  value: string;
  deleted: boolean;

  constructor(id: Identifier, originId: Identifier | null, value: string) {
    this.id = id;
    this.originId = originId;
    this.value = value;
    this.deleted = false;
  }
}

// Convert Identifier to string for Map key lookups
export function idToString(id: Identifier | null): string {
  if (!id) return 'null';
  return `${id.clientId}:${id.counter}`;
}

// Compare two identifiers. Returns >0 if a > b, <0 if a < b, 0 if equal.
// Higher counter wins. If counters are equal, alphabetical clientId breaks ties.
export function compareIds(a: Identifier, b: Identifier): number {
  if (a.counter !== b.counter) {
    return a.counter - b.counter;
  }
  if (a.clientId < b.clientId) return -1;
  if (a.clientId > b.clientId) return 1;
  return 0;
}

export class RGACrdt {
  clientId: string;
  counter: number;
  nodes: RGANode[];

  constructor(clientId: string) {
    this.clientId = clientId;
    this.counter = 0;
    this.nodes = [];
  }

  // Helper to find index of a node by ID
  findNodeIndex(id: Identifier | null): number {
    if (!id) return -1;
    return this.nodes.findIndex(
      (n) => n.id.counter === id.counter && n.id.clientId === id.clientId
    );
  }

  // Insert a character locally at a visible (non-deleted) index
  insert(char: string, index: number): RGANode {
    this.counter++;
    const newId: Identifier = { counter: this.counter, clientId: this.clientId };
    
    let originId: Identifier | null = null;
    let targetIndex = -1; // Index in the backing array where the origin is

    if (index > 0) {
      // Find the index-th visible node
      let visibleCount = 0;
      for (let i = 0; i < this.nodes.length; i++) {
        if (!this.nodes[i].deleted) {
          visibleCount++;
          if (visibleCount === index) {
            originId = this.nodes[i].id;
            targetIndex = i;
            break;
          }
        }
      }
      if (targetIndex === -1) {
        throw new Error(`Insert index ${index} out of bounds`);
      }
    } else {
      // Inserting at index 0, origin is null
      targetIndex = -1;
    }

    const newNode = new RGANode(newId, originId, char);
    
    // In local insert, we just place it directly after the target index (which is originIdx)
    this.nodes.splice(targetIndex + 1, 0, newNode);
    return newNode;
  }

  // Delete a character locally at a visible (non-deleted) index
  delete(index: number): RGANode {
    let visibleCount = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      if (!this.nodes[i].deleted) {
        if (visibleCount === index) {
          this.nodes[i].deleted = true;
          return this.nodes[i];
        }
        visibleCount++;
      }
    }
    throw new Error(`Delete index ${index} out of bounds`);
  }

  // Merge a remote node into this CRDT instance
  mergeNode(remoteNode: RGANode): boolean {
    // If we already have this node, ignore it (idempotency)
    if (this.findNodeIndex(remoteNode.id) !== -1) {
      return false;
    }

    // Find the insert position. We start scanning from originIdx + 1
    const originIdx = this.findNodeIndex(remoteNode.originId);
    
    // Build set of descendant IDs to track the causal branch of skipped siblings
    const descendantIds = new Set<string>();

    let insertIdx = originIdx + 1;
    while (insertIdx < this.nodes.length) {
      const nextNode = this.nodes[insertIdx];
      const nextOriginStr = idToString(nextNode.originId);
      const remoteOriginStr = idToString(remoteNode.originId);

      // Rule 1: Skip if nextNode is a descendant of remoteNode's origin
      if (descendantIds.has(nextOriginStr)) {
        descendantIds.add(idToString(nextNode.id));
        insertIdx++;
      } 
      // Rule 2: If sharing the same origin, order by ID comparison (concurrent insertion sibling)
      else if (nextOriginStr === remoteOriginStr) {
        if (compareIds(nextNode.id, remoteNode.id) > 0) {
          descendantIds.add(idToString(nextNode.id));
          insertIdx++;
        } else {
          break; // Our remote node has higher priority than nextNode, stop skipping
        }
      } 
      // Rule 3: Different origin branches, stop skipping
      else {
        break;
      }
    }

    // Clone node to prevent sharing mutable references across states
    const nodeToInsert = new RGANode(remoteNode.id, remoteNode.originId, remoteNode.value);
    nodeToInsert.deleted = remoteNode.deleted;

    // Splice in the merged node
    this.nodes.splice(insertIdx, 0, nodeToInsert);
    
    // Update local counter to match causal history max
    this.counter = Math.max(this.counter, remoteNode.id.counter);
    return true;
  }

  // Merge a full remote CRDT instance state
  merge(remoteCrdt: RGACrdt) {
    // In RGA, we can sort remote nodes by causal order (or simple counter) 
    // and merge them one-by-one to resolve dependencies correctly.
    const sortedNodes = [...remoteCrdt.nodes].sort((a, b) => a.id.counter - b.id.counter);
    
    for (const node of sortedNodes) {
      const existingIdx = this.findNodeIndex(node.id);
      if (existingIdx === -1) {
        this.mergeNode(node);
      } else {
        // If node exists but was deleted remotely, mark it deleted locally too (tombstone merge)
        if (node.deleted) {
          this.nodes[existingIdx].deleted = true;
        }
      }
    }
  }

  // Reconstruct current text value by joining non-deleted characters
  toString(): string {
    return this.nodes
      .filter((n) => !n.deleted)
      .map((n) => n.value)
      .join('');
  }
}
