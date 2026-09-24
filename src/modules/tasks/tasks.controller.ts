import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiEndpoint } from '../../common/decorators/api-endpoint.decorator';
import { PERMISSION_GROUPS } from '../../common/auth/permissions.catalog';
import { TasksService } from './tasks.service';
import {
  CreateTaskDto,
  ListTasksQueryDto,
  TaskResponseDto,
  TransitionTaskDto,
  UpdateTaskDto,
} from './dto/task.dto';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  @ApiEndpoint({
    summary: 'Create a task',
    operationId: 'tasksCreate',
    permissions: [PERMISSION_GROUPS.tasks.create],
    statusCode: 201,
    responseType: TaskResponseDto,
  })
  create(@Body() body: CreateTaskDto) {
    return this.tasks.create(body);
  }

  @Get()
  @ApiEndpoint({
    summary: 'List tasks (filters + pagination)',
    operationId: 'tasksList',
    permissions: [PERMISSION_GROUPS.tasks.read],
    responseType: ListTasksQueryDto,
  })
  list(@Query() query: ListTasksQueryDto) {
    return this.tasks.list(query);
  }

  @Get(':id')
  @ApiEndpoint({
    summary: 'Get a task',
    operationId: 'tasksGet',
    permissions: [PERMISSION_GROUPS.tasks.read],
    responseType: TaskResponseDto,
  })
  get(@Param('id') id: string) {
    return this.tasks.get(id);
  }

  @Patch(':id')
  @ApiEndpoint({
    summary: 'Edit task metadata (while OPEN)',
    operationId: 'tasksUpdate',
    permissions: [PERMISSION_GROUPS.tasks.update],
    responseType: TaskResponseDto,
  })
  update(@Param('id') id: string, @Body() body: UpdateTaskDto) {
    return this.tasks.update(id, body);
  }

  @Post(':id/transition')
  @ApiEndpoint({
    summary: 'Start, complete or cancel a task',
    operationId: 'tasksTransition',
    permissions: [PERMISSION_GROUPS.tasks.update],
    statusCode: 201,
    responseType: TaskResponseDto,
    errors: [{ status: 409, description: 'Invalid workflow transition' }],
  })
  transition(@Param('id') id: string, @Body() body: TransitionTaskDto) {
    return this.tasks.transition(id, body);
  }
}