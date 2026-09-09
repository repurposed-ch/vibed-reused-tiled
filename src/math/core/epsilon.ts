import { clusterByCenter } from '../analysis/clustering/center';

export class Epsilon {
  static readonly type = 'Epsilon' as const;

  static readonly value = 1e-6;
  static readonly sq = Epsilon.value * Epsilon.value;

  readonly value: number;
  readonly sq: number;

  static readonly preferIn = new Epsilon(Epsilon.value);
  static readonly preferOut = new Epsilon(-Epsilon.value);

  private constructor(value: number) {
    Epsilon.validateSlackNumber(value);
    this.value = value;
    this.sq = value * value;
  }

  /** Resolve boolean, numeric, or pre-built slack to an `Epsilon` tolerance. */
  static custom(input: boolean | number | Epsilon): Epsilon {
    if (input instanceof Epsilon) {
      return input;
    }

    if (typeof input === 'number') {
      return new Epsilon(input);
    }

    if (input === true) {
      return Epsilon.preferIn ?? new Epsilon(Epsilon.value);
    }

    return Epsilon.preferOut ?? new Epsilon(-Epsilon.value);
  }

  /** Ensure the epsilon value is positive */
  isPositive(type: string, label: string): void {
    if (this.value < Epsilon.value) {
      throw new Error(`epsilon value for operation ${label} on ${type} must be >= ${Epsilon.value}`);
    }
  }

  private static validateSlackNumber(slack: number): void {
    if (slack > -Epsilon.value && slack < Epsilon.value) {
      throw new Error(`slack numeric tolerance must be >= ${Epsilon.value} or <= ${-Epsilon.value}`);
    }
  }

  areEqual(a: number, b: number): boolean {
    return Math.abs(a - b) <= this.value;
  }

  /** Merge values that fall within this `epsilon` of an existing cluster representative. */
  clusterSortedValues(values: number[]): number[] {
    return clusterByCenter(values, this).map((cluster) => cluster.mean);
  }

  toJson(): EpsilonJson {
    return {
      type: Epsilon.type,
      value: this.value,
    };
  }
}

export type EpsilonJson = {
  type: typeof Epsilon.type;
  value: number;
};
