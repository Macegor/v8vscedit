import { NodeDescriptor } from '../_types';

export const ExchangePlanDescriptor: NodeDescriptor = {
  icon: 'exchangePlan',
  folderName: 'ExchangePlans',
  children: ['Attribute', 'TabularSection', 'Form', 'Command'],
  contextMenuCommands: ['openObjectModule', 'openManagerModule'],
};

