import { NodeDescriptor } from '../_types';

export const AccumulationRegisterDescriptor: NodeDescriptor = {
  icon: 'accumulationRegister',
  folderName: 'AccumulationRegisters',
  children: ['Dimension', 'Resource', 'Form', 'Command'],
  contextMenuCommands: ['openObjectModule', 'openManagerModule'],
};

