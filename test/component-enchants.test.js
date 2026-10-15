/* eslint-env mocha */
const expect = require('expect').default
const nbt = require('prismarine-nbt')

for (const version of ['1.20.5', '1.20.6', '1.21.1', '1.21.4', '1.21.5', '1.21.6', '1.21.11', '26.1']) {
  describe(`component enchantments (${version})`, () => {
    const registry = require('prismarine-registry')(version)
    const Item = require('prismarine-item')(registry)
    const component = (type, entries) => ({
      type,
      data: {
        enchantments: entries.map(([name, level]) => ({ id: registry.enchantmentsByName[name].id, level })),
        ...(registry.version['<']('1.21.5') ? { [type === 'stored_enchantments' ? 'showInTooltip' : 'showTooltip']: true } : {})
      }
    })
    const item = (name, components) => Item.fromNotch({ itemId: registry.itemsByName[name].id, itemCount: 1, components, removeComponents: [] })

    it('normalizes the efficiency and silk touch of a received pickaxe', () => {
      const pickaxe = item('diamond_pickaxe', [component('enchantments', [['efficiency', 5], ['silk_touch', 1], ['unbreaking', 3]])])
      const wire = JSON.parse(JSON.stringify(Item.toNotch(pickaxe)))
      expect(pickaxe.enchants).toStrictEqual([
        { name: 'efficiency', lvl: 5 },
        { name: 'silk_touch', lvl: 1 },
        { name: 'unbreaking', lvl: 3 }
      ])
      expect(Item.toNotch(pickaxe)).toStrictEqual(wire)
      expect(Item.fromNotch(wire).enchants).toStrictEqual(pickaxe.enchants)
    })

    it('reads enchanted book stored enchantments instead of the applied component', () => {
      const book = item('enchanted_book', [
        component('enchantments', [['unbreaking', 1]]),
        component('stored_enchantments', [['efficiency', 5]])
      ])
      expect(book.enchants).toStrictEqual([{ name: 'efficiency', lvl: 5 }])
    })

    it('reads a book with only stored enchantments', () => {
      const book = item('enchanted_book', [component('stored_enchantments', [['mending', 1]])])
      expect(book.enchants).toStrictEqual([{ name: 'mending', lvl: 1 }])
    })

    it('does not use applied enchantments when a book has no stored component', () => {
      const book = item('enchanted_book', [component('enchantments', [['efficiency', 5]])])
      expect(book.enchants).toStrictEqual([])
      expect(Item.fromNotch(Item.toNotch(book)).enchants).toStrictEqual([])
    })

    it('keeps an explicitly empty stored component empty', () => {
      const book = item('enchanted_book', [
        component('enchantments', [['unbreaking', 1]]),
        component('stored_enchantments', [])
      ])
      expect(book.enchants).toStrictEqual([])
    })

    it('returns an array for absent or empty components', () => {
      expect(item('diamond_pickaxe', []).enchants).toStrictEqual([])
      expect(item('diamond_pickaxe', [component('enchantments', [])]).enchants).toStrictEqual([])
      expect(item('enchanted_book', []).enchants).toStrictEqual([])
    })

    it('preserves the legacy null-name representation for unknown enchantment IDs', () => {
      const pickaxe = item('diamond_pickaxe', [{ type: 'enchantments', data: { enchantments: [{ id: 1000000, level: 2 }] } }])
      expect(pickaxe.enchants).toStrictEqual([{ name: null, lvl: 2 }])
    })

    for (const [name, type] of [['diamond_pickaxe', 'enchantments'], ['enchanted_book', 'stored_enchantments']]) {
      describe(name, () => {
        const original = () => component(type, [['mending', 1]])
        const changed = [{ name: 'unbreaking', lvl: 3 }]
        const roundTrip = value => Item.fromNotch(Item.toNotch(value))

        it('creates a protocol-shaped component through the public setter', () => {
          const value = new Item(registry.itemsByName[name].id, 1)
          value.enchants = changed
          expect(value.componentMap.get(type)).toStrictEqual(component(type, [['unbreaking', 3]]))
          expect(value.enchants).toStrictEqual(changed)
          expect(roundTrip(value).enchants).toStrictEqual(changed)
          expect(value.nbt).toBe(null)
        })

        it('replaces existing enchantments and preserves component metadata and unrelated state', () => {
          const entry = original()
          const tooltipKey = type === 'stored_enchantments' ? 'showInTooltip' : 'showTooltip'
          if (tooltipKey in entry.data) entry.data[tooltipKey] = false
          const otherType = type === 'enchantments' ? 'stored_enchantments' : 'enchantments'
          const other = component(otherType, [['efficiency', 5]])
          const packet = { itemId: registry.itemsByName[name].id, itemCount: 1, components: [entry, other], removeComponents: [{ type: 'custom_name' }] }
          const before = structuredClone(packet)
          const value = Item.fromNotch(packet)
          value.enchants = changed
          expect(value.enchants).toStrictEqual(changed)
          const wire = Item.toNotch(value)
          expect(wire.components).toStrictEqual([{ type, data: { ...entry.data, enchantments: component(type, [['unbreaking', 3]]).data.enchantments } }, other])
          expect(wire.removeComponents).toStrictEqual(packet.removeComponents)
          expect(wire.addedComponentCount).toBe(2)
          expect(wire.removedComponentCount).toBe(1)
          expect(roundTrip(value).enchants).toStrictEqual(changed)
          expect(packet).toStrictEqual(before)
        })

        it('clears enchantments through the public setter', () => {
          const value = item(name, [original()])
          value.enchants = []
          expect(value.enchants).toStrictEqual([])
          expect(value.componentMap.get(type).data.enchantments).toStrictEqual([])
          expect(roundTrip(value).enchants).toStrictEqual([])
        })

        it('does not grant modern enchantments from legacy tags in custom_data', () => {
          const tag = type === 'stored_enchantments' ? 'StoredEnchantments' : 'Enchantments'
          const data = nbt.comp({ [tag]: nbt.list(nbt.comp([{ id: nbt.string('minecraft:efficiency'), lvl: nbt.short(5) }])) })
          const value = item(name, [{ type: 'custom_data', data }])
          expect(value.enchants).toStrictEqual([])
          expect(roundTrip(value).enchants).toStrictEqual([])
          expect(Item.toNotch(value).components).toStrictEqual([{ type: 'custom_data', data }])
        })

        it('respects removals before serialization and restores them through the setter', () => {
          const value = item(name, [original()])
          const tag = type === 'stored_enchantments' ? 'StoredEnchantments' : 'Enchantments'
          value.nbt = nbt.comp({ [tag]: nbt.list(nbt.comp([{ id: nbt.string('minecraft:efficiency'), lvl: nbt.short(5) }])) })
          value.removedComponents.push({ type })
          expect(value.enchants).toStrictEqual([])
          expect(roundTrip(value).enchants).toStrictEqual([])
          expect(Item.toNotch(value).removeComponents).toContainEqual({ type })
          value.enchants = changed
          expect(value.removedComponents).toStrictEqual([])
          expect(value.enchants).toStrictEqual(changed)
          expect(roundTrip(value).enchants).toStrictEqual(changed)
        })

        it('reads array and map edits from the same state that is serialized', () => {
          const value = item(name, [])
          value.components.push(original())
          expect(value.enchants).toStrictEqual([{ name: 'mending', lvl: 1 }])
          value.componentMap.set(type, component(type, [['unbreaking', 3]]))
          expect(value.enchants).toStrictEqual(changed)
          expect(roundTrip(value).enchants).toStrictEqual(changed)
          value.componentMap.delete(type)
          expect(value.enchants).toStrictEqual([])
          expect(roundTrip(value).enchants).toStrictEqual([])
        })

        it('reads unknown IDs without changing their raw serialization', () => {
          const entry = component(type, [])
          entry.data.enchantments.push({ id: 1000000, level: 2 })
          const value = item(name, [entry])
          const before = structuredClone(Item.toNotch(value))
          expect(value.enchants).toStrictEqual([{ name: null, lvl: 2 }])
          expect(Item.toNotch(value)).toStrictEqual(before)
          expect(roundTrip(value).enchants).toStrictEqual([{ name: null, lvl: 2 }])
        })

        it('rejects unknown names without partially changing the component', () => {
          const value = item(name, [original()])
          const before = structuredClone(Item.toNotch(value))
          expect(() => { value.enchants = [...changed, { name: 'not_a_real_enchantment', lvl: 2 }] }).toThrow()
          expect(Item.toNotch(value)).toStrictEqual(before)
          expect(value.enchants).toStrictEqual([{ name: 'mending', lvl: 1 }])
        })
      })
    }
  })
}
