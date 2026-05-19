/** DTO одной команды */
export interface CommandDto {
  readonly id: string;
  readonly title: string;
  readonly tooltip?: string;
  readonly icon?: string;
  readonly category?: string;
  readonly enabled?: boolean;
  readonly visible?: boolean;
}

/** DTO группы команд */
export interface CommandGroupDto {
  readonly id: string;
  readonly title: string;
  readonly commands: CommandDto[];
}
