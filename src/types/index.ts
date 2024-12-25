export interface Vector {
  x: number
  y: number
}
export interface NoteData {
  pitch: number
  time: number
  duration: number
  active: boolean
  id: string
  _remove?: boolean // Temporary data: do not serialise
  _duration?: number // Temporary data: do not serialise
}
export interface SelectionArea {
  start: Vector
  end: Vector
}
export interface Loop {
  time: number
  duration: number
}
export type Mode = 'note' | 'select' | 'pan' | 'stretch'
