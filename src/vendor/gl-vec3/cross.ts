/**
 * Computes the cross product of two vec3's
 *
 * @param {vec3} out the receiving vector
 * @param {vec3} a the first operand
 * @param {vec3} b the second operand
 * @returns {vec3} out
 */
export default function cross(out, a, b) {
  let ax = a[0]
  let ay = a[1]
  let az = a[2]
  let bx = b[0]
  let by = b[1]
  let bz = b[2]

  out[0] = ay * bz - az * by
  out[1] = az * bx - ax * bz
  out[2] = ax * by - ay * bx
  return out
}
