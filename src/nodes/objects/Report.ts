import { NodeDescriptor } from '../_types';

export const ReportDescriptor: NodeDescriptor = {
  icon: 'report',
  folderName: 'Reports',
  children: ['Attribute', 'TabularSection', 'Form', 'Command', 'Template'],
  contextMenuCommands: ['openObjectModule', 'openManagerModule'],
};

