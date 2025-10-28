export interface RuntimeAoe {
  dot?: any;
  lake?: any;
  wall?: any;
  [key: string]: any;
}

export type MapSchema<T = any> = Record<string, T>;

export type MinimalSnapshot = any;
