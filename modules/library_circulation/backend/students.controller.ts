import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { PrismaClient } from '@prisma/client';
import type { Request, Response } from 'express';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { Audit, AuthenticatedUser, CurrentUser, MustChangePasswordGuard, RequirePermission } from './platform';
import { StudentsExcelService } from './students-excel.service';
import { StudentsService } from './students.service';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Profile + the linked account's editable fields (never the password hash) — what the audit trail records for a reader. */
const fetchStudentState = async (prisma: PrismaClient, req: Request) => {
  const student = await prisma.libraryStudent.findUnique({ where: { id: req.params.id as string } });
  if (!student) return null;
  const user = await prisma.user.findUnique({
    where: { id: student.userId },
    select: { name: true, email: true, externalId: true, department: true, isActive: true, mustChangePassword: true },
  });
  return { ...student, ...user };
};

@Controller('api/library-circulation/students')
@UseGuards(MustChangePasswordGuard)
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly excel: StudentsExcelService,
  ) {}

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

  /** Suggested next reader code for the Add form (read-only peek; same pattern as library_catalog's `copies/next-code`). Before `:id` for the usual Express ordering reason. */
  @Get('next-code')
  @RequirePermission('library_circulation.students.create')
  async peekNextCode() {
    return { code: await this.students.peekNextCode() };
  }

  @Get('export')
  @RequirePermission('library_circulation.students.export')
  async export(@Res() res: Response): Promise<void> {
    const buffer = await this.excel.exportWorkbook();
    res.set({ 'Content-Type': XLSX_CONTENT_TYPE, 'Content-Disposition': 'attachment; filename="library-readers-export.xlsx"' });
    res.send(buffer);
  }

  /** Validates only — writes nothing (same preview/commit split as core's users import, D42). */
  @Post('import/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('library_circulation.students.import')
  @UseInterceptors(FileInterceptor('file'))
  async importPreview(@UploadedFile() file?: { buffer: Buffer }) {
    if (!file) throw new BadRequestException('No file uploaded (expected multipart field "file")');
    return this.excel.validateRows(await this.excel.parseWorkbook(file.buffer));
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('library_circulation.students.import')
  @Audit({ category: 'library_circulation.students', entityType: 'LibraryStudent', action: 'import' })
  @UseInterceptors(FileInterceptor('file'))
  async importCommit(@UploadedFile() file: { buffer: Buffer } | undefined, @CurrentUser() user: AuthenticatedUser) {
    if (!file) throw new BadRequestException('No file uploaded (expected multipart field "file")');
    return this.excel.commit(file.buffer, user.userId);
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
