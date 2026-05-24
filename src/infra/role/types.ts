export interface RoleInfoOptions {
  readonly rightsPath: string;
  readonly showDenied?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export interface RoleValidationOptions {
  readonly rightsPath: string;
  readonly detailed?: boolean;
  readonly maxErrors?: number;
}

export interface RoleCompileOptions {
  readonly outputDir: string;
  readonly definition: RoleDefinition;
}

export interface RoleDefinition {
  readonly name: string;
  readonly synonym?: string;
  readonly comment?: string;
  readonly setForNewObjects?: boolean;
  readonly setForAttributesByDefault?: boolean;
  readonly independentRightsOfChildObjects?: boolean;
  readonly objects?: readonly RoleObjectDefinition[];
  readonly rights?: readonly RoleObjectDefinition[];
  readonly templates?: readonly RoleRestrictionTemplateDefinition[];
}

export type RoleObjectDefinition = string | {
  readonly name?: string;
  readonly preset?: string;
  readonly rights?: readonly string[] | Record<string, boolean>;
  readonly rls?: Record<string, string>;
};

export interface RoleRestrictionTemplateDefinition {
  readonly name: string;
  readonly condition: string;
}

export interface RoleInfoResult {
  readonly rightsPath: string;
  readonly metadataPath?: string;
  readonly name: string;
  readonly synonym: string;
  readonly properties: RoleGlobalFlags;
  readonly allowed: readonly RoleObjectRightsGroup[];
  readonly denied: readonly RoleObjectRightsGroup[];
  readonly templates: readonly string[];
  readonly rls: readonly string[];
  readonly totalAllowed: number;
  readonly totalDenied: number;
  readonly lines: readonly string[];
}

export interface RoleObjectRightsGroup {
  readonly type: string;
  readonly objects: readonly RoleObjectRights[];
}

export interface RoleObjectRights {
  readonly name: string;
  readonly rights: readonly string[];
}

export interface RoleValidationIssue {
  readonly severity: 'error' | 'warning' | 'ok';
  readonly message: string;
}

export interface RoleValidationResult {
  readonly rightsPath: string;
  readonly metadataPath?: string;
  readonly name: string;
  readonly errors: number;
  readonly warnings: number;
  readonly checks: number;
  readonly issues: readonly RoleValidationIssue[];
  readonly lines: readonly string[];
}

export interface RoleCompileResult {
  readonly name: string;
  readonly metadataPath: string;
  readonly rightsPath: string;
  readonly changedFiles: readonly string[];
  readonly warnings: readonly string[];
}

export interface RoleGlobalFlags {
  readonly setForNewObjects: string;
  readonly setForAttributesByDefault: string;
  readonly independentRightsOfChildObjects: string;
}

export interface DefaultRolesListOptions {
  readonly configPath: string;
}

export interface DefaultRolesListResult {
  readonly configXmlPath: string;
  readonly roles: readonly string[];
}

export interface DefaultRolesMutationOptions {
  readonly configPath: string;
  readonly role: string;
}

export interface DefaultRolesSetOptions {
  readonly configPath: string;
  readonly roles: readonly string[];
}

export interface DefaultRolesMutationResult {
  readonly success: boolean;
  readonly changed: boolean;
  readonly configXmlPath: string;
  readonly roles: readonly string[];
  readonly changedFiles: readonly string[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

export type RoleRightsEditOperation =
  | {
      readonly op: 'grant';
      readonly object: string;
      readonly preset?: string;
      readonly rights?: readonly string[] | Record<string, boolean>;
      readonly rls?: Record<string, string>;
    }
  | {
      readonly op: 'revoke';
      readonly object: string;
      readonly rights?: readonly string[];
    }
  | {
      readonly op: 'setRls';
      readonly object: string;
      readonly right: string;
      readonly condition?: string;
    }
  | {
      readonly op: 'setFlags';
      readonly flags: {
        readonly setForNewObjects?: boolean;
        readonly setForAttributesByDefault?: boolean;
        readonly independentRightsOfChildObjects?: boolean;
      };
    }
  | {
      readonly op: 'addTemplate';
      readonly name: string;
      readonly condition: string;
    }
  | {
      readonly op: 'removeTemplate';
      readonly name: string;
    };

export interface RoleRightsEditOptions {
  readonly rightsPath: string;
  readonly operations: readonly RoleRightsEditOperation[];
}

export interface RoleRightsEditResult {
  readonly success: boolean;
  readonly changed: boolean;
  readonly rightsPath: string;
  readonly applied: number;
  readonly changedFiles: readonly string[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}
