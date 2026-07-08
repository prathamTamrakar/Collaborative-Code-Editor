import { RGACrdt } from './rga.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

console.log('🧪 Running Custom RGA CRDT Unit Tests...');

try {
  // Test 1: Single client basic edits
  (() => {
    const crdt = new RGACrdt('client-a');
    crdt.insert('H', 0);
    crdt.insert('e', 1);
    crdt.insert('l', 2);
    crdt.insert('l', 3);
    crdt.insert('o', 4);
    
    assert(crdt.toString() === 'Hello', 'Basic inserts failed');
    
    crdt.delete(2); // Delete 'l'
    assert(crdt.toString() === 'Helo', 'Delete failed');
    console.log('✅ Test 1: Basic edits passed');
  })();

  // Test 2: Convergent merging of concurrent inserts (non-overlapping)
  (() => {
    const crdtA = new RGACrdt('client-a');
    const crdtB = new RGACrdt('client-b');
    
    // Sync initial state "Hi"
    crdtA.insert('H', 0);
    crdtA.insert('i', 1);
    crdtB.merge(crdtA);

    // Client A inserts "!" at end
    crdtA.insert('!', 2);
    
    // Client B inserts " " at start
    crdtB.insert(' ', 0);
    
    // Cross-merge
    crdtA.merge(crdtB);
    crdtB.merge(crdtA);
    
    assert(crdtA.toString() === ' Hi!', 'Client A merge failed');
    assert(crdtB.toString() === ' Hi!', 'Client B merge failed');
    assert(crdtA.toString() === crdtB.toString(), 'Divergent text after merge');
    console.log('✅ Test 2: Concurrent non-overlapping inserts passed');
  })();

  // Test 3: Concurrent inserts at the exact same location (tie-breaking test)
  (() => {
    const crdtA = new RGACrdt('client-a');
    const crdtB = new RGACrdt('client-b');
    
    // Sync initial state "cat"
    crdtA.insert('c', 0);
    crdtA.insert('a', 1);
    crdtA.insert('t', 2);
    crdtB.merge(crdtA);

    // Client A inserts "s" after "a" -> "cast"
    crdtA.insert('s', 2);
    
    // Client B inserts "r" after "a" -> "cart"
    crdtB.insert('r', 2);
    
    // Cross-merge
    crdtA.merge(crdtB);
    crdtB.merge(crdtA);
    
    // Since client-b has higher client id alphabetically, B's insertion might break tie
    // But either way, both clients MUST arrive at the exact same string
    assert(crdtA.toString() === crdtB.toString(), 'Divergent state on concurrent overlap insert');
    assert(crdtA.toString() === 'cars-t' || crdtA.toString() === 'casrt' || crdtA.toString() === 'carst', `State: ${crdtA.toString()}`);
    console.log(`✅ Test 3: Concurrent same-origin insert tie-breaking passed (merged: "${crdtA.toString()}")`);
  })();

  // Test 4: Concurrent insert vs delete (Tombstone merge test)
  (() => {
    const crdtA = new RGACrdt('client-a');
    const crdtB = new RGACrdt('client-b');
    
    // Sync initial state "dog"
    crdtA.insert('d', 0);
    crdtA.insert('o', 1);
    crdtA.insert('g', 2);
    crdtB.merge(crdtA);

    // Client A deletes "o" -> "dg"
    crdtA.delete(1);
    
    // Client B inserts "s" after "o" -> "dosg"
    crdtB.insert('s', 2);
    
    // Cross-merge
    crdtA.merge(crdtB);
    crdtB.merge(crdtA);
    
    // The result should contain "s" even though "o" was deleted
    // String should be "dsg"
    assert(crdtA.toString() === crdtB.toString(), 'Divergence on delete-insert conflict');
    assert(crdtA.toString() === 'dsg', `Expected "dsg" but got "${crdtA.toString()}"`);
    console.log('✅ Test 4: Insert-after-delete tombstone merge passed');
  })();

  // Test 5: Idempotency, commutativity, and associativity
  (() => {
    const crdtA = new RGACrdt('client-a');
    const crdtB = new RGACrdt('client-b');
    const crdtC = new RGACrdt('client-c');

    crdtA.insert('X', 0);
    crdtB.insert('Y', 0);
    crdtC.insert('Z', 0);

    // Merge A and B multiple times (Idempotency)
    crdtA.merge(crdtB);
    crdtA.merge(crdtB);
    crdtB.merge(crdtA);
    assert(crdtA.toString() === crdtB.toString(), 'Idempotency check failed');

    // Merge in different orderings (Commutativity & Associativity)
    // A has merged (A, B)
    // Let's merge C into A: A represents (A + B) + C
    crdtA.merge(crdtC);

    // Let's create another merger: C merges A (which contains A+B) -> C represents C + (A + B)
    crdtC.merge(crdtB);
    crdtC.merge(crdtA);

    assert(crdtA.toString() === crdtC.toString(), 'Associativity check failed');
    console.log('✅ Test 5: Idempotency & Associativity passed');
  })();

  console.log('\n🎉 ALL CUSTOM CRDT TESTS COMPLETED SUCCESSFULLY! 🎉');
} catch (error: any) {
  console.error('\n❌ TEST SUITE FAILED ❌');
  console.error(error);
  throw error;
}
