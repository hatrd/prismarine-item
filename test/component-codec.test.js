/* eslint-env mocha */
const assert = require('assert/strict')
const nbt = require('prismarine-nbt')
const { createSerializer } = require('minecraft-protocol')

for (const version of ['1.20.5', '1.20.6', '1.21.1', '1.21.4', '1.21.5', '1.21.6', '1.21.11', '26.1']) {
  describe(`component binary codec (${version})`, () => {
    const registry = require('prismarine-registry')(version)
    const Item = require('prismarine-item')(registry)
    const serializer = createSerializer({ state: 'play', isServer: true, version })
    const make = (name = 'diamond_pickaxe') => new Item(registry.itemsByName[name].id, 1)
    const roundTrip = item => {
      const bytes = serializer.createPacketBuffer({ name: 'set_slot', params: { windowId: 0, stateId: 1, slot: 36, item: Item.toNotch(item) } })
      const decoded = serializer.proto.parsePacketBuffer('packet', bytes)
      assert.equal(decoded.metadata.size, bytes.length)
      const slot = decoded.data.params.item
      assert.equal(slot.addedComponentCount, slot.components.length)
      assert.equal(slot.removedComponentCount, slot.removeComponents.length)
      return Item.fromNotch(slot)
    }

    for (const [name, type] of [['diamond_pickaxe', 'enchantments'], ['enchanted_book', 'stored_enchantments']]) {
      it(`${name}: writes, clears, removes and restores enchantments on the wire`, () => {
        const item = make(name)
        item.enchants = [{ name: 'mending', lvl: 1 }]
        assert.deepEqual(roundTrip(item).enchants, item.enchants)
        const key = type === 'enchantments' ? 'showTooltip' : 'showInTooltip'
        if (registry.version['<']('1.21.5')) item.componentMap.get(type).data[key] = false
        item.enchants = [{ name: 'unbreaking', lvl: 3 }]
        const updated = roundTrip(item)
        assert.deepEqual(updated.enchants, item.enchants)
        if (registry.version['<']('1.21.5')) assert.equal(updated.componentMap.get(type).data[key], false)
        item.enchants = []
        assert.deepEqual(roundTrip(item).enchants, [])
        item.removedComponents.push({ type })
        assert.deepEqual(roundTrip(item).enchants, [])
        item.enchants = [{ name: 'mending', lvl: 1 }]
        assert.deepEqual(roundTrip(item).enchants, item.enchants)
        assert.deepEqual(roundTrip(item).removedComponents, [])
        item.componentMap.delete(type)
        assert.deepEqual(roundTrip(item).enchants, [])
      })

      it(`${name}: preserves unknown numeric IDs on the wire`, () => {
        const item = make(name)
        item.enchants = []
        item.componentMap.get(type).data.enchantments.push({ id: 1000000, level: 2 })
        const back = roundTrip(item)
        assert.deepEqual(back.enchants, [{ name: null, lvl: 2 }])
        assert.deepEqual(Item.toNotch(back).components, Item.toNotch(item).components)
      })

      for (const unknown of ['not_a_real_enchantment', '__proto__', 'constructor', 'toString']) {
        it(`${name}: rejects ${unknown} atomically, including existing removals`, () => {
          const item = make(name)
          item.enchants = [{ name: 'mending', lvl: 1 }]
          item.removedComponents.push({ type })
          const before = structuredClone(Item.toNotch(item))
          assert.throws(() => { item.enchants = [{ name: 'unbreaking', lvl: 3 }, { name: unknown, lvl: 2 }] }, /Unknown enchantment/)
          assert.deepEqual(Item.toNotch(item), before)
          assert.deepEqual(roundTrip(item).enchants, [])
        })
      }
    }

    for (const [label, input, expected] of [
      ['JSON object', '{"text":"镐子","color":"gold","italic":false}', { text: '镐子', color: 'gold', italic: 0 }],
      ['JSON string', '"Quoted text"', 'Quoted text'],
      ['plain text', 'Literal name', 'Literal name'],
      ['typed literal JSON', nbt.string('{"text":"literal"}'), '{"text":"literal"}'],
      ['mixed children', '{"text":"A","extra":["B",{"text":"C","bold":true}]}', { text: 'A', extra: [{ text: 'B' }, { text: 'C', bold: 1 }] }],
      ['mixed root array', '["A",{"text":"B"}]', [{ text: 'A' }, { text: 'B' }]],
      ['translation arguments', '{"translate":"test","with":[2,{"text":"B"}]}', { translate: 'test', with: [{ text: '2' }, { text: 'B' }] }],
      ['hover text', '{"text":"A","hoverEvent":{"action":"show_text","contents":["B",{"text":"C"}]}}', { text: 'A', hoverEvent: { action: 'show_text', contents: [{ text: 'B' }, { text: 'C' }] } }],
      ['nested component arrays', '["A",[{"text":"B","color":"red"},"C"]]', [{ text: 'A' }, { text: 'B', color: 'red', extra: ['C'] }]]
    ]) {
      it(`round-trips name and lore: ${label}`, () => {
        const item = make()
        const before = structuredClone(input)
        item.customName = input
        item.customLore = [input]
        const back = roundTrip(item)
        assert.deepEqual(JSON.parse(back.customName), expected)
        assert.deepEqual(back.customLore.map(JSON.parse), [expected])
        assert.deepEqual(input, before)
      })
    }

    it('removes, restores and clears name/lore on the wire', () => {
      const item = make()
      item.customName = 'Original'
      item.customLore = ['First', 'Second']
      item.customName = null
      item.customLore = null
      assert.equal(roundTrip(item).customName, null)
      assert.equal(roundTrip(item).customLore, null)
      item.customName = 'Restored'
      item.customLore = 'Single line'
      assert.equal(roundTrip(item).customName, '"Restored"')
      assert.deepEqual(roundTrip(item).customLore, ['"Single line"'])
      assert.deepEqual(item.removedComponents, [])
      item.customLore = []
      assert.deepEqual(roundTrip(item).customLore, [])
    })

    it('rejects invalid lore without partially replacing the old component or removal', () => {
      const item = make()
      item.customLore = ['Original']
      item.removedComponents.push({ type: 'lore' })
      const before = structuredClone(Item.toNotch(item))
      assert.throws(() => { item.customLore = ['Valid first line', null] }, /Expected a chat/)
      assert.deepEqual(Item.toNotch(item), before)
    })
  })
}
