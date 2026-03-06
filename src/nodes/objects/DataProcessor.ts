import { NodeDescriptor } from '../_types';

export const DataProcessorDescriptor: NodeDescriptor = {
  icon: 'dataProcessor',
  folderName: 'DataProcessors',
  children: ['Attribute', 'TabularSection', 'Form', 'Command', 'Template'],
  contextMenuCommands: ['openObjectModule', 'openManagerModule'],
};

