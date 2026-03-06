import { NodeDescriptor } from '../_types';

export const CatalogDescriptor: NodeDescriptor = {
  icon: 'catalog',
  folderName: 'Catalogs',
  children: ['Attribute', 'TabularSection', 'Form', 'Command', 'Template'],
  contextMenuCommands: ['openObjectModule', 'openManagerModule'],
};

