function buildPrompt({role,task, context="",format=""}) {
    return `
    Role: ${role}
    Task:${task}
    ${context?`Context:\n${context}\n`:''}
    ${format ? `Output format:\n${format}\n`:''}
    `
}
export default buildPrompt