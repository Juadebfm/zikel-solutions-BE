import { type Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { httpError } from '../../lib/errors.js';
import type { CreateFaqBody, ListFaqsQuery, UpdateFaqBody } from './faqs.schema.js';

export async function listFaqs(query: ListFaqsQuery) {
  const { page, pageSize, search, category } = query;

  const where: Prisma.FaqArticleWhereInput = {
    deletedAt: null,
    isPublished: true,
  };

  if (category) {
    where.category = category;
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { body: { contains: search, mode: 'insensitive' } },
      { tags: { has: search } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.faqArticle.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        body: true,
        category: true,
        tags: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.faqArticle.count({ where }),
  ]);

  return {
    data,
    meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function listFaqsAdmin(query: ListFaqsQuery) {
  const { page, pageSize, search, category } = query;

  const where: Prisma.FaqArticleWhereInput = { deletedAt: null };
  if (category) where.category = category;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { body: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.faqArticle.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.faqArticle.count({ where }),
  ]);

  return {
    data,
    meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function getFaq(id: string) {
  const faq = await prisma.faqArticle.findFirst({
    where: { id, deletedAt: null },
  });

  if (!faq) {
    throw httpError(404, 'FAQ_NOT_FOUND', 'FAQ article not found.');
  }

  return faq;
}

export async function createFaq(userId: string, body: CreateFaqBody) {
  return prisma.faqArticle.create({
    data: {
      title: body.title,
      body: body.body,
      category: body.category,
      tags: body.tags,
      sortOrder: body.sortOrder,
      isPublished: body.isPublished,
      createdById: userId,
    },
  });
}

export async function updateFaq(id: string, body: UpdateFaqBody) {
  const existing = await prisma.faqArticle.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'FAQ_NOT_FOUND', 'FAQ article not found.');
  }

  const data: Parameters<typeof prisma.faqArticle.update>[0]['data'] = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.body !== undefined) data.body = body.body;
  if (body.category !== undefined) data.category = body.category;
  if (body.tags !== undefined) data.tags = body.tags;
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
  if (body.isPublished !== undefined) data.isPublished = body.isPublished;

  return prisma.faqArticle.update({ where: { id }, data });
}

export async function deleteFaq(id: string) {
  const existing = await prisma.faqArticle.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });

  if (!existing) {
    throw httpError(404, 'FAQ_NOT_FOUND', 'FAQ article not found.');
  }

  await prisma.faqArticle.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return { message: 'FAQ article deleted.' };
}
