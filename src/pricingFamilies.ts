export function pricingFamilyLabel(family: string) {
  return family === 'MiniMax (minimax.io)' ? 'MiniMax' : family
}

export function pricingFamilies(models: { family: string }[]) {
  const priority = ['anthropic', 'openai', 'deepseek']
  const rank = (name: string) => {
    const index = priority.indexOf(name.toLowerCase())
    return index === -1 ? priority.length : index
  }
  return [...new Set(models.map(model => model.family))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'zh-CN'))
}
