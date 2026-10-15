const nbt = require('prismarine-nbt')

// Public chat values are JSON strings. The component protocol carries typed
// NBT instead; keep that conversion at the boundary, before changing item state.
function toJson (component) {
  if (component == null || typeof component === 'string') return component
  const value = typeof component.type === 'string' && 'value' in component ? nbt.simplify(component) : component
  return JSON.stringify(value)
}

function toNbt (component) {
  // Preserve explicitly typed input, including literal text that looks like JSON.
  if (component && typeof component.type === 'string' && 'value' in component) return component
  if (typeof component !== 'string') throw new TypeError('Expected a chat JSON string or an NBT tag')
  let value
  try { value = JSON.parse(component) } catch { return nbt.string(component) }
  // Plain numeric/boolean names are text too. A JS null removes the component;
  // the string "null" is a literal name, not a removal request.
  if (value == null || typeof value !== 'object') return nbt.string(String(value))
  if (Array.isArray(value) && !value.length) throw new TypeError('Cannot encode an empty chat component array')
  return jsonTag(value, true)
}

function jsonTag (value, chatList = false) {
  if (typeof value === 'string') return nbt.string(value)
  if (typeof value === 'boolean') return nbt.byte(Number(value))
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? nbt.int(value) : nbt.double(value)
  }
  if (Array.isArray(value)) {
    let tags = value.map(entry => jsonTag(entry, chatList))
    // NBT lists have one element type. Chat lists (root, extra, with) can mix
    // shorthand text and objects; expand their shorthand to text compounds.
    if (chatList && tags.some(tag => tag.type !== tags[0].type)) {
      tags = value.map(entry => jsonTag(chatCompound(entry)))
    }
    if (tags.some(tag => tag.type !== tags[0].type)) throw new TypeError('Cannot encode a mixed non-chat NBT list')
    return { type: 'list', value: { type: tags[0]?.type ?? 'end', value: tags.map(tag => tag.value) } }
  }
  if (value && typeof value === 'object') {
    return nbt.comp(Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      const childChat = key === 'extra' || key === 'with' || key === 'separator' || key === 'name' ||
        (value.action === 'show_text' && (key === 'contents' || key === 'value'))
      return [key, jsonTag(entry, childChat)]
    })))
  }
  throw new TypeError('Cannot encode null or non-finite chat fields')
}

function chatCompound (value) {
  if (Array.isArray(value)) {
    if (!value.length) throw new TypeError('Cannot encode an empty chat component array')
    const [first, ...rest] = value
    const head = chatCompound(first)
    return { ...head, extra: [...(head.extra ?? []), ...rest] }
  }
  return typeof value === 'object' ? value : { text: String(value) }
}

module.exports = { toJson, toNbt }
