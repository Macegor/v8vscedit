import { NodeDescriptor } from '../_types';

export const ChartOfCalculationTypesDescriptor: NodeDescriptor = {
  icon: 'chartsOfCalculationType',
  folderName: 'ChartsOfCalculationTypes',
  children: ['Attribute', 'TabularSection', 'Form', 'Command'],
  contextMenuCommands: ['openObjectModule', 'openManagerModule'],
};

