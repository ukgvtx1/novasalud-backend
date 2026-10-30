export const fechaHoraConOffset = (valor) => {
  if (!valor) return null
  const texto = String(valor)
  if (texto.includes('T')) return texto.endsWith('Z') ? texto : `${texto}-05:00`
  return `${texto.replace(' ', 'T')}-05:00`
}
