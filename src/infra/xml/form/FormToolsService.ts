import { FormAddService } from './FormAddService';
import { FormCompileService } from './FormCompileService';
import { FormEditService } from './FormEditService';
import { FormInfoService } from './FormInfoService';
import { FormValidateService } from './FormValidateService';
import type {
  AddFormOptions,
  CompileFormOptions,
  EditFormOptions,
  FormInfoOptions,
  FormInfoResult,
  FormMutationResult,
  FormValidationResult,
  RemoveFormOptions,
  ValidateFormOptions,
} from './types';

/**
 * Фасад для всех операций над формами 1С. Делегирует в специализированные
 * сервисы из подкаталога `form/`. Сохранён ради обратной совместимости —
 * вызывающий код знает только этот класс и не зависит от внутренней
 * декомпозиции.
 */
export class FormToolsService {
  private readonly addService = new FormAddService();
  private readonly compileService = new FormCompileService();
  private readonly editService = new FormEditService();
  private readonly infoService = new FormInfoService();
  private readonly validateService = new FormValidateService();

  addForm(options: AddFormOptions): FormMutationResult {
    return this.addService.addForm(options);
  }

  removeForm(options: RemoveFormOptions): FormMutationResult {
    return this.addService.removeForm(options);
  }

  compile(options: CompileFormOptions): FormMutationResult {
    return this.compileService.compile(options);
  }

  edit(options: EditFormOptions): FormMutationResult {
    return this.editService.edit(options);
  }

  info(options: FormInfoOptions): FormInfoResult {
    return this.infoService.info(options);
  }

  validate(options: ValidateFormOptions): FormValidationResult {
    return this.validateService.validate(options);
  }
}
