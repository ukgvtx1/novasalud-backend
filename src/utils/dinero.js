export const redondear = (valor) => Number(Number(valor || 0).toFixed(2))

export const calcularImpuestos = (total) => {
  const totalRedondeado = redondear(total)
  const subtotal = redondear(totalRedondeado / 1.18)
  return { subtotal, igv: redondear(totalRedondeado - subtotal), total: totalRedondeado }
}
