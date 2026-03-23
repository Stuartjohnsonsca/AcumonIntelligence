declare module 'jstat' {
  export const jStat: {
    studentt: {
      inv(p: number, dof: number): number;
      cdf(x: number, dof: number): number;
      pdf(x: number, dof: number): number;
    };
    normal: {
      inv(p: number, mean: number, std: number): number;
      cdf(x: number, mean: number, std: number): number;
    };
    chisquare: {
      inv(p: number, dof: number): number;
    };
  };
}
