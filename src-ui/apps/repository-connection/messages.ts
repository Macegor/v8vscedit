/** Данные формы подключения к хранилищу для отправки host-провайдеру */
export interface RepositoryConnectionFormData {
  readonly repoPath: string;
  readonly repoUser: string;
  readonly repoPassword: string;
  readonly forceBindAlreadyBindedUser?: boolean;
  readonly forceReplaceCfg?: boolean;
  readonly allowConfigurationChanges?: boolean;
  readonly changesAllowedRule?: string;
  readonly changesNotRecommendedRule?: string;
  readonly noBind?: boolean;
}

/** Сообщения от UI формы подключения host-провайдеру */
export type RepositoryConnectionUiMessage =
  | { readonly type: 'command'; readonly command: 'submit'; readonly payload: RepositoryConnectionFormData }
  | { readonly type: 'command'; readonly command: 'cancel' }
  | { readonly type: 'request'; readonly requestId: string; readonly name: 'browseRepoPath' };
