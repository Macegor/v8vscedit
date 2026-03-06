import { NodeDescriptor } from '../_types';

export const ChartOfAccountsDescriptor: NodeDescriptor = {
  icon: 'chartsOfAccount',
  folderName: 'ChartsOfAccounts',
  children: ['Attribute', 'TabularSection', 'Form', 'Command'],
  contextMenuCommands: ['openObjectModule', 'openManagerModule'],
};

