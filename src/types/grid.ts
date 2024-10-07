/**
 * Represents a margin with the a specified thickness in pixels.
 */
export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Data structure that represents an area on a 2D plane.
 *
 * The {@link x} and {@link y} coordinates identify the north-west corner of the
 * rectangle, assuming that the origin of the plane is also in the north-west
 * corner and has coordinates (0, 0).
 */
export interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}