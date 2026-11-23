export type ValidationIssue = { path: string; message: string };
export type ValidationError = { kind: 'validation'; issues: ValidationIssue[]; message: string };
