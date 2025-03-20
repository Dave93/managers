import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { candidates, education, vacancy, last_work_place, family_list } from "backend/drizzle/schema";
import { and, eq, InferSelectModel, sql, SQLWrapper } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

type CandidateInsert = typeof candidates.$inferInsert;
type EducationInsert = typeof education.$inferInsert;
type LastWorkPlaceInsert = typeof last_work_place.$inferInsert;
type FamilyListInsert = typeof family_list.$inferInsert;
type ErrorResponse = { message: string; stack?: string };
type ResultStatus = "positive" | "negative" | "neutral" | null;

interface EducationEntry {
    dateStart: string;
    dateEnd: string;
    educationType: string;
    university: string;
    speciality: string;
}

interface LastWorkPlaceEntry {
    lastWorkPlace: string;
    dismissalDate: string;
    employmentDate: string;
    experience: string;
    organizationName: string;
    position: string;
    addressOrg: string;
    dismissalReason: string;
    
}

interface FamilyListEntry {
    familyListName: string;
    familyListBirthDate: string;
    familyListPhone: string;
    familyListRelation: string;
    familyListAddress: string;
    familyJob: string;
}

interface CandidateBody {
    vacancyId: string;
    fullName: string;
    birthDate: string;
    phoneNumber: string;
    email?: string;
    citizenship?: string;
    residence?: string;
    passportNumber?: string;
    passportSeries?: string;
    passportIdDate?: string;
    passportIdPlace?: string;
    source?: string;
    familyStatus?: string;
    children?: number;
    language?: string;
    desiredSalary?: string;
    desiredSchedule?: string;
    purpose?: string;
    strengthsShortage?: string;
    relatives?: string;
    desiredPosition?: string;
    resultStatus?: ResultStatus;
    educations?: EducationEntry[];
    lastWorkPlaces?: LastWorkPlaceEntry[];
    isFirstJob?: boolean;
    familyLists?: FamilyListEntry[];
}

export const candidatesController = new Elysia({
    name: "@api/candidates",
})
    .use(ctx)
    .get("/candidates", async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle}) => {
        try {
            let selectFields: SelectedFields = {
                id: candidates.id,
                vacancyId: vacancy.applicationNum,
                fullName: candidates.fullName,
                birthDate: candidates.birthDate,
                phoneNumber: candidates.phoneNumber,
                email: candidates.email,
                citizenship: candidates.citizenship,
                residence: candidates.residence,
                passportNumber: candidates.passportNumber,
                passportSeries: candidates.passportSeries,
                passportIdDate: candidates.passportIdDate,
                passportIdPlace: candidates.passportIdPlace,
                source: candidates.source,
                familyStatus: candidates.familyStatus,
                children: candidates.children,
                language: candidates.language,
                strengthsShortage: candidates.strengthsShortage,
                relatives: candidates.relatives,
                desiredSalary: candidates.desiredSalary,
                desiredSchedule: candidates.desiredSchedule,
                purpose: candidates.purpose,
                desiredPosition: candidates.desiredPosition,
                resultStatus: candidates.resultStatus,
                createdAt: candidates.createdAt,
                updatedAt: candidates.updatedAt,
                isFirstJob: candidates.isFirstJob,
            };

            if (fields) {
                selectFields = parseSelectFields(fields, candidates, {
                    vacancy: vacancy,
                });
            }

            let whereClause: SQLWrapper[] = [];
            if (filters) {
                const parsedFilters = parseFilterFields(filters, candidates, {
                    vacancy: vacancy,
                    education: education,
                    last_work_place: last_work_place,
                    family_list: family_list,

                });
                whereClause = parsedFilters.filter((clause): clause is SQLWrapper => clause !== undefined);
            }

            // Обрабатываем сортировку
            let sortFields: any[] = [];
            if (sort) {
                try {
                    // Используем any для обхода проблем с типами
                    sortFields = parseSelectFields(sort, candidates, {
                        vacancy: vacancy,
                    }) as any[];
                    sortFields = sortFields.filter(field => field !== undefined);
                } catch (error) {
                    console.error('Error parsing sort fields:', error);
                }
            }

            const whereConditions = whereClause.length > 0 ? and(...whereClause) : undefined;

            // Получаем кандидатов с учетом фильтров и сортировки
            const candidatesResult = await drizzle
                .select(selectFields)
                .from(candidates)
                .leftJoin(vacancy, eq(candidates.vacancyId, vacancy.id))
                .where(whereConditions)
                .limit(limit ? Number(limit) : 10)
                .offset(offset ? Number(offset) : 0)
                .orderBy(...sortFields)
                .execute();

            // Получаем общее количество кандидатов
            const [{ count }] = await drizzle
                .select({ count: sql<number>`count(*)` })
                .from(candidates)
                .where(whereConditions)
                .execute();

            // Получаем дополнительные данные для каждого кандидата
            const candidatesWithDetails = await Promise.all(
                candidatesResult.map(async (candidate) => {
                    // Получаем данные об образовании
                    const educationData = await drizzle
                        .select()
                        .from(education)
                        .where(eq(education.candidateId, candidate.id as string))
                        .execute();

                    // Получаем данные о последних местах работы
                    const lastWorkPlaceData = await drizzle
                        .select()
                        .from(last_work_place)
                        .where(eq(last_work_place.candidateId, candidate.id as string))
                        .execute();

                    // Получаем данные о родственниках
                    const familyListData = await drizzle
                        .select()
                        .from(family_list)
                        .where(eq(family_list.candidateId, candidate.id as string))
                        .execute();

                    // Возвращаем кандидата с дополнительными данными
                    return {
                        ...candidate,
                        education: educationData,
                        lastWorkPlace: lastWorkPlaceData,
                        familyList: familyListData
                    };
                })
            );

            return {
                data: candidatesWithDetails,
                meta: {
                    total: Number(count),
                    limit: limit ? Number(limit) : 10,
                    offset: offset ? Number(offset) : 0,
                }
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to fetch candidates",
                message: err.message
            };
        }
    }, {
        permission: "candidates.list",
        query: t.Object({
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
            sort: t.Optional(t.String()),
            filters: t.Optional(t.String()),
            fields: t.Optional(t.String())
        })
    })

    .post("/candidates", async ({ body, user, set, drizzle, cacheController }) => {
        try {
            // Validate request body
            if (!body || typeof body !== 'object') {
                set.status = 400;
                return {
                    error: 'Invalid request body',
                    message: 'Request body must be an object'
                };
            }

            const candidateBody = body as CandidateBody;

            // Validate required fields
            if (!candidateBody.vacancyId) {
                set.status = 400;
                return {
                    error: 'Missing required field',
                    message: 'vacancyId is required'
                };
            }

            if (!candidateBody.fullName) {
                set.status = 400;
                return {
                    error: 'Missing required field',
                    message: 'fullName is required'
                };
            }

            if (!candidateBody.phoneNumber) {
                set.status = 400;
                return {
                    error: 'Missing required field',
                    message: 'phoneNumber is required'
                };
            }

            console.log('Starting candidate creation with data:', candidateBody);
            console.log('Education data received:', candidateBody.educations);

            // Start transaction
            const result = await drizzle.transaction(async (tx) => {
                // Создаем кандидата
                const [newCandidate] = await tx
                    .insert(candidates)
                    .values({
                        ...candidateBody,
                        desiredSalary: candidateBody.desiredSalary ? Number(candidateBody.desiredSalary) : null,
                        resultStatus: candidateBody.resultStatus as ResultStatus | null,
                        isFirstJob: candidateBody.isFirstJob || false,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning()
                    .execute();

                console.log('Created candidate:', newCandidate);

                // Обрабатываем данные об образовании, если они предоставлены
                let educationData: InferSelectModel<typeof education>[] = [];
                let lastWorkPlaceData: InferSelectModel<typeof last_work_place>[] = [];
                let familyListData: InferSelectModel<typeof family_list>[] = [];

                if (candidateBody.educations && Array.isArray(candidateBody.educations) && candidateBody.educations.length > 0) {
                    console.log('Processing education data:', candidateBody.educations);

                    try {
                        const educationRecords = candidateBody.educations.map(edu => ({
                            candidateId: newCandidate.id,
                            dateStart: new Date(edu.dateStart).toISOString(),
                            dateEnd: new Date(edu.dateEnd).toISOString(),
                            educationType: edu.educationType,
                            university: edu.university,
                            speciality: edu.speciality
                        }));

                        console.log('Inserting education records:', educationRecords);

                        educationData = await tx
                            .insert(education)
                            .values(educationRecords)
                            .returning()
                            .execute();

                        console.log('Created education records:', educationData);
                    } catch (educationError) {
                        console.error('Error creating education records:', educationError);
                        // Continue without education if there's an error
                    }
                } else {
                    console.log('No education data to process');
                }

                // Обрабатываем данные о последних местах работы, если они предоставлены и это не первое место работы
                if (!candidateBody.isFirstJob && candidateBody.lastWorkPlaces && Array.isArray(candidateBody.lastWorkPlaces) && candidateBody.lastWorkPlaces.length > 0) {
                    console.log('Processing last work place data:', candidateBody.lastWorkPlaces);

                    try {
                        const lastWorkPlaceRecords = candidateBody.lastWorkPlaces.map(work => ({
                            candidateId: newCandidate.id,
                            lastWorkPlace: work.lastWorkPlace || null,
                            dismissalDate: new Date(work.dismissalDate).toISOString(),
                            employmentDate: new Date(work.employmentDate).toISOString(),
                            experience: work.experience || null,
                            organizationName: work.organizationName,
                            position: work.position,
                            addressOrg: work.addressOrg || null,
                            dismissalReason: work.dismissalReason || null
                        }));

                        console.log('Inserting last work place records:', lastWorkPlaceRecords);

                        lastWorkPlaceData = await tx
                            .insert(last_work_place)
                            .values(lastWorkPlaceRecords)
                            .returning()
                            .execute();

                        console.log('Created last work place records:', lastWorkPlaceData);
                    } catch (lastWorkPlaceError) {
                        console.error('Error creating last work place records:', lastWorkPlaceError);
                        // Continue without last work place if there's an error
                    }
                } else {
                    console.log('No last work place data to process');
                }

                // Обрабатываем данные о родственниках, если они предоставлены
                if (candidateBody.familyLists && Array.isArray(candidateBody.familyLists) && candidateBody.familyLists.length > 0) {
                    console.log('Processing family list data:', candidateBody.familyLists);

                    try {
                        const familyListRecords = candidateBody.familyLists.map(family => ({
                            candidateId: newCandidate.id,
                            familyListName: family.familyListName,
                            familyListBirthDate: family.familyListBirthDate ? new Date(family.familyListBirthDate).toISOString() : null,
                            familyListPhone: family.familyListPhone || null,
                            familyListRelation: family.familyListRelation,
                            familyListAddress: family.familyListAddress || null,
                            familyJob: family.familyJob || null
                        }));

                        console.log('Inserting family list records:', familyListRecords);

                        familyListData = await tx
                            .insert(family_list)
                            .values(familyListRecords)
                            .returning()
                            .execute();

                        console.log('Created family list records:', familyListData);
                    } catch (familyListError) {
                        console.error('Error creating family list records:', familyListError);
                        // Continue without family list if there's an error
                    }
                } else {
                    console.log('No family list data to process');
                }

                // Возвращаем кандидата с дополнительными данными
                return {
                    ...newCandidate,
                    education: educationData,
                    lastWorkPlace: lastWorkPlaceData,
                    familyList: familyListData
                };
            });

            await cacheController.cachePermissions();
            return { data: result };
        } catch (error: any) {
            console.error('Error creating candidate:', {
                message: error?.message || 'Unknown error',
                stack: error?.stack,
                body: body
            });
            set.status = 500;
            return {
                error: 'Failed to create candidate',
                message: error?.message || 'Unknown error'
            };
        }
    }, {
        permission: "candidates.add",
        body: t.Object({
            vacancyId: t.String(),
            fullName: t.String(),
            birthDate: t.Optional(t.String()),
            phoneNumber: t.String(),
            email: t.Optional(t.String()),
            citizenship: t.Optional(t.String()),
            residence: t.Optional(t.String()),
            passportNumber: t.Optional(t.String()),
            passportSeries: t.Optional(t.String()),
            passportIdDate: t.Optional(t.String()),
            passportIdPlace: t.Optional(t.String()),
            source: t.Optional(t.String()),
            familyStatus: t.Optional(t.String()),
            children: t.Optional(t.Number()),
            language: t.Optional(t.String()),
            desiredSalary: t.Optional(t.String()),
            desiredSchedule: t.Optional(t.String()),
            purpose: t.Optional(t.String()),
            strengthsShortage: t.Optional(t.String()),
            relatives: t.Optional(t.String()),
            desiredPosition: t.Optional(t.String()),
            resultStatus: t.Optional(t.Enum({ positive: "positive", negative: "negative", neutral: "neutral" })),
            educations: t.Optional(t.Array(t.Object({
                dateStart: t.String(),
                dateEnd: t.String(),
                educationType: t.String(),
                university: t.String(),
                speciality: t.String()
            }))),
            lastWorkPlaces: t.Optional(t.Array(t.Object({
                lastWorkPlace: t.Optional(t.String()),
                dismissalDate: t.String(),
                employmentDate: t.String(),
                experience: t.Optional(t.String()),
                organizationName: t.String(),
                position: t.String(),
                addressOrg: t.Optional(t.String()),
                dismissalReason: t.Optional(t.String())
            }))),
            isFirstJob: t.Optional(t.Boolean()),
            familyLists: t.Optional(t.Array(t.Object({
                familyListName: t.String(),
                familyListBirthDate: t.Optional(t.String()),
                familyListPhone: t.Optional(t.String()),
                familyListRelation: t.String(),
                familyListAddress: t.Optional(t.String()),
                familyJob: t.Optional(t.String())
            }))),
        })
    })

    .put("/candidates/:id", async ({ params: { id }, body, user, set, drizzle, cacheController }) => {
        try {
            const updateData = {
                ...body,
                desiredSalary: body.desiredSalary ? Number(body.desiredSalary) : undefined,
                resultStatus: body.resultStatus as ResultStatus | undefined,
                isFirstJob: body.isFirstJob,
                updatedAt: new Date(),
            };

            // Обновляем данные кандидата в транзакции
            const result = await drizzle.transaction(async (tx) => {
                // Обновляем основные данные кандидата
                const [updatedCandidate] = await tx
                    .update(candidates)
                    .set(updateData)
                    .where(eq(candidates.id, id))
                    .returning()
                    .execute();

                if (!updatedCandidate) {
                    throw new Error("Candidate not found");
                }

                // Обрабатываем данные об образовании, если они предоставлены
                let educationResult: InferSelectModel<typeof education>[] = [];
                let lastWorkPlaceResult: InferSelectModel<typeof last_work_place>[] = [];
                let familyListResult: InferSelectModel<typeof family_list>[] = [];

                if (body.educations && Array.isArray(body.educations) && body.educations.length > 0) {
                    console.log('Processing education records for update:', body.educations);

                    try {
                        // Сначала удаляем существующие записи об образовании
                        await tx
                            .delete(education)
                            .where(eq(education.candidateId, id))
                            .execute();

                        // Затем добавляем новые записи
                        const educationRecords = body.educations.map(edu => ({
                            candidateId: id,
                            dateStart: new Date(edu.dateStart).toISOString(),
                            dateEnd: new Date(edu.dateEnd).toISOString(),
                            educationType: edu.educationType,
                            university: edu.university,
                            speciality: edu.speciality
                        }));

                        educationResult = await tx
                            .insert(education)
                            .values(educationRecords)
                            .returning()
                            .execute();

                        console.log('Updated education records:', educationResult);
                    } catch (educationError) {
                        console.error('Error updating education records:', educationError);
                    }
                }

                // Обрабатываем данные о последних местах работы, если они предоставлены и это не первое место работы
                if (!body.isFirstJob && body.lastWorkPlaces && Array.isArray(body.lastWorkPlaces) && body.lastWorkPlaces.length > 0) {
                    console.log('Processing last work place records for update:', body.lastWorkPlaces);

                    try {
                        // Сначала удаляем существующие записи о местах работы
                        await tx
                            .delete(last_work_place)
                            .where(eq(last_work_place.candidateId, id))
                            .execute();

                        // Затем добавляем новые записи
                        const lastWorkPlaceRecords = body.lastWorkPlaces.map(work => ({
                            candidateId: id,
                            lastWorkPlace: work.lastWorkPlace || null,
                            dismissalDate: new Date(work.dismissalDate).toISOString(),
                            employmentDate: new Date(work.employmentDate).toISOString(),
                            experience: work.experience || null,
                            organizationName: work.organizationName,
                            position: work.position,
                            addressOrg: work.addressOrg || null,
                            dismissalReason: work.dismissalReason || null
                        }));

                        lastWorkPlaceResult = await tx
                            .insert(last_work_place)
                            .values(lastWorkPlaceRecords)
                            .returning()
                            .execute();

                        console.log('Updated last work place records:', lastWorkPlaceResult);
                    } catch (lastWorkPlaceError) {
                        console.error('Error updating last work place records:', lastWorkPlaceError);
                    }
                }

                // Обрабатываем данные о родственниках, если они предоставлены
                if (body.familyLists && Array.isArray(body.familyLists) && body.familyLists.length > 0) {
                    console.log('Processing family list records for update:', body.familyLists);

                    try {
                        // Сначала удаляем существующие записи о родственниках
                        await tx
                            .delete(family_list)
                            .where(eq(family_list.candidateId, id))
                            .execute();

                        // Затем добавляем новые записи
                        const familyListRecords = body.familyLists.map(family => ({
                            candidateId: id,
                            familyListName: family.familyListName,
                            familyListBirthDate: family.familyListBirthDate ? new Date(family.familyListBirthDate).toISOString() : null,
                            familyListPhone: family.familyListPhone || null,
                            familyListRelation: family.familyListRelation,
                            familyListAddress: family.familyListAddress || null,
                            familyJob: family.familyJob || null
                        }));

                        familyListResult = await tx
                            .insert(family_list)
                            .values(familyListRecords)
                            .returning()
                            .execute();

                        console.log('Updated family list records:', familyListResult);
                    } catch (familyListError) {
                        console.error('Error updating family list records:', familyListError);
                    }
                }

                return {
                    ...updatedCandidate,
                    education: educationResult,
                    lastWorkPlace: lastWorkPlaceResult,
                    familyList: familyListResult
                };
            });

            await cacheController.cachePermissions();
            return {
                data: result,
            };
        } catch (error) {
            const err = error as ErrorResponse;
            set.status = 500;
            return {
                error: "Failed to update candidate",
                message: err.message
            };
        }
    }, {
        permission: "candidates.edit",
        params: t.Object({
            id: t.String(),
        }),
        body: t.Object({
            vacancyId: t.String(),
            fullName: t.String(),
            birthDate: t.String(),
            phoneNumber: t.String(),
            email: t.Optional(t.String()),
            citizenship: t.Optional(t.String()),
            residence: t.Optional(t.String()),
            passportNumber: t.Optional(t.String()),
            passportSeries: t.Optional(t.String()),
            passportIdDate: t.Optional(t.String()),
            passportIdPlace: t.Optional(t.String()),
            source: t.Optional(t.String()),
            familyStatus: t.Optional(t.String()),
            children: t.Optional(t.Number()),
            language: t.Optional(t.String()),
            strengthsShortage: t.Optional(t.String()),
            relatives: t.Optional(t.String()),
            desiredSalary: t.Optional(t.String()),
            desiredSchedule: t.Optional(t.String()),
            purpose: t.Optional(t.String()),
            desiredPosition: t.Optional(t.String()),
            resultStatus: t.Optional(t.Enum({ positive: "positive", negative: "negative", neutral: "neutral" })),
            educations: t.Optional(t.Array(t.Object({
                dateStart: t.String(),
                dateEnd: t.String(),
                educationType: t.String(),
                university: t.String(),
                speciality: t.String()
            }))),
            lastWorkPlaces: t.Optional(t.Array(t.Object({
                lastWorkPlace: t.Optional(t.String()),
                dismissalDate: t.String(),
                employmentDate: t.String(),
                experience: t.Optional(t.String()),
                organizationName: t.String(),
                position: t.String(),
                addressOrg: t.Optional(t.String()),
                dismissalReason: t.Optional(t.String())
            }))),
            isFirstJob: t.Optional(t.Boolean()),
            familyLists: t.Optional(t.Array(t.Object({
                familyListName: t.String(),
                familyListBirthDate: t.Optional(t.String()),
                familyListPhone: t.Optional(t.String()),
                familyListRelation: t.String(),
                familyListAddress: t.Optional(t.String()),
                familyJob: t.Optional(t.String())
            }))),
        })
    })

    .delete("/candidates/:id", async ({ params: { id }, user, set, drizzle, cacheController }) => {
        try {
            console.log('Starting deletion process for candidate:', id);
            
            // First check if candidate exists outside transaction
            const candidateExists = await drizzle
                .select({ id: candidates.id })
                .from(candidates)
                .where(eq(candidates.id, id))
                .execute();

            if (candidateExists.length === 0) {
                console.log('Candidate not found:', id);
                set.status = 404;
                return {
                    error: "Candidate not found"
                };
            }

            // Check for related records
            const relatedEducation = await drizzle
                .select({ count: sql<number>`count(*)` })
                .from(education)
                .where(eq(education.candidateId, id))
                .execute();

            console.log('Found related education records:', relatedEducation[0].count);

            // Execute everything in a transaction
            const result = await drizzle.transaction(async (tx) => {
                console.log('Starting transaction');

                try {
                    // First delete all education records
                    if (relatedEducation[0].count > 0) {
                        console.log('Attempting to delete education records');
                        const deletedEducation = await tx
                            .delete(education)
                            .where(eq(education.candidateId, id))
                            .returning()
                            .execute();
                        
                        console.log(`Successfully deleted ${deletedEducation.length} education records`);
                    }

                    // Delete all last work place records
                    console.log('Attempting to delete work place records');
                    const deletedWorkPlaces = await tx
                        .delete(last_work_place)
                        .where(eq(last_work_place.candidateId, id))
                        .returning()
                        .execute();
                    
                    console.log(`Successfully deleted ${deletedWorkPlaces.length} work place records`);

                    // Delete all family list records
                    console.log('Attempting to delete family list records');
                    const deletedFamilyLists = await tx
                        .delete(family_list)
                        .where(eq(family_list.candidateId, id))
                        .returning()
                        .execute();
                    
                    console.log(`Successfully deleted ${deletedFamilyLists.length} family member records`);

                    // Finally, delete the candidate
                    console.log('Attempting to delete candidate');
                    const deletedCandidate = await tx
                        .delete(candidates)
                        .where(eq(candidates.id, id))
                        .returning()
                        .execute();

                    console.log('Candidate deletion result:', deletedCandidate);

                    if (deletedCandidate.length === 0) {
                        throw new Error("Failed to delete candidate after removing related records");
                    }

                    return {
                        candidate: deletedCandidate[0],
                        deletedData: {
                            education: relatedEducation[0].count,
                            workPlaces: deletedWorkPlaces.length,
                            familyMembers: deletedFamilyLists.length
                        }
                    };
                } catch (deleteError) {
                    console.error('Error during deletion process:', deleteError);
                    throw deleteError;
                }
            });

            console.log('Transaction completed successfully:', result);
            await cacheController.cachePermissions();
            return {
                data: result,
                message: "Candidate and all related data deleted successfully"
            };
        } catch (error) {
            const err = error as ErrorResponse;
            console.error('Failed to delete candidate:', err);
            set.status = 500;
            return {
                error: "Failed to delete candidate",
                message: err.message
            };
        }
    }, {
        permission: "candidates.delete",
        params: t.Object({
            id: t.String(),
        })
    }) 