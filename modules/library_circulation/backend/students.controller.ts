import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';
import { StudentsService } from './students.service';

const fetchStudentState = (prisma: PrismaClient, req: Request) =>
  prisma.libraryStudent.findUnique({ where: { id: req.params.id as string } });

@Controller('api/library-circulation/students')
@UseGuards(MustChangePasswordGuard)
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  @RequirePermission('library_circulation.students.view')
  async list() {
    return this.students.list();
  }

  @Get(':id')
  @RequirePermission('library_circulation.students.view')
  async findById(@Param('id') id: string) {
    return this.students.findById(id);
  }

  @Post()
  @RequirePermission('library_circulation.students.create')
  @Audit({ category: 'library_circulation.students', entityType: 'LibraryStudent', action: 'create' })
  async create(@Body() dto: CreateStudentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.students.create(dto, user.userId);
  }

  @Patch(':id')
  @RequirePermission('library_circulation.students.update')
  @Audit({ category: 'library_circulation.students', entityType: 'LibraryStudent', action: 'update', fetchState: fetchStudentState })
  async update(@Param('id') id: string, @Body() dto: UpdateStudentDto) {
    return this.students.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('library_circulation.students.delete')
  @Audit({ category: 'library_circulation.students', entityType: 'LibraryStudent', action: 'delete', fetchState: fetchStudentState })
  async remove(@Param('id') id: string): Promise<void> {
    await this.students.remove(id);
  }
}
