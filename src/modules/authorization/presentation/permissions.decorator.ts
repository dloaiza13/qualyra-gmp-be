import { SetMetadata } from '@nestjs/common';

export const requiredPermissionsKey = 'qualyra.required-permissions';

export const Permissions = (
  ...permissions: string[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(requiredPermissionsKey, permissions);
