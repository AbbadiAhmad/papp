import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
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

  /**
   * Searchable reader picker (Fines page's [Create Fine] dialog, Scan page's
   * search-by-name lookup) — registered BEFORE `:id` so Express never treats
   * "search" as an id (same lesson as every other module's own docblock on
   * this, e.g. library_catalog's books.controller.ts).
   */
  @Get('search')
  @RequirePermission('library_circulation.students.view')
  async search(@Query('q') q: string) {
    return this.students.search(q ?? '');
  }

  @Get(':id')
  @RequirePermission('library_circulation.students.view')
  async findById(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.students.findById(id);
  }

  /** §3.2 "Reading History" tab — every borrowing ever, never just the active ones. */
  @Get(':id/reading-history')
  @RequirePermission('library_circulation.students.view')
  async readingHistory(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.students.getReadingHistory(id);
  }

  /** §3.3 "Actions" tab — audit trail of operations on this reader's own account row. */
  @Get(':id/action-history')
  @RequirePermission('library_circulation.students.view')
  async actionHistory(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.students.getActionHistory(id);
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
  async update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateStudentDto) {
    return this.students.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('library_circulation.students.delete')
  @Audit({ category: 'library_circulation.students', entityType: 'LibraryStudent', action: 'delete', fetchState: fetchStudentState })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.students.remove(id);
  }
}
