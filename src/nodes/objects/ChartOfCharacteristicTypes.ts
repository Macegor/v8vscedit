import { NodeDescriptor } from '../_types';

export const ChartOfCharacteristicTypesDescriptor: NodeDescriptor = {
  icon: 'chartsOfCharacteristicType',
  folderName: 'ChartsOfCharacteristicTypes',
  children: ['Attribute', 'TabularSection', 'Form', 'Command'],
  contextMenuCommands: ['openObjectModule', 'openManagerModule'],
};

