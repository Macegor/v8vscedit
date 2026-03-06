import { NodeDescriptor } from '../_types';

export const CalculationRegisterDescriptor: NodeDescriptor = {
  icon: 'calculationRegister',
  folderName: 'CalculationRegisters',
  children: ['Dimension', 'Resource', 'Form', 'Command'],
  contextMenuCommands: ['openObjectModule', 'openManagerModule'],
};

