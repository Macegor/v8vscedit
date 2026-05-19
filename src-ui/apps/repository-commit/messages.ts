export interface RepositoryCommitFormData {
  readonly comment: string;
  readonly recursive: boolean;
  readonly keepLocked: boolean;
  readonly force: boolean;
}

export type RepositoryCommitUiMessage =
  | { readonly type: 'command'; readonly command: 'submit'; readonly payload: RepositoryCommitFormData }
  | { readonly type: 'command'; readonly command: 'cancel' };
