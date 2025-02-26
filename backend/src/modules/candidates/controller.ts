import { ctx } from "@backend/context";
import { parseFilterFields } from "@backend/lib/parseFilterFields";
import { parseSelectFields } from "@backend/lib/parseSelectFields";
import { candidates, education, vacancy } from "backend/drizzle/schema";
import { and, eq, InferSelectModel, sql, SQLWrapper } from "drizzle-orm";
import { SelectedFields } from "drizzle-orm/pg-core";
import Elysia, { t } from "elysia";

type CandidateInsert = typeof candidates.$inferInsert;
type EducationInsert = typeof education.$inferInsert;
type ErrorResponse = { message: string; stack?: string };
type ResultStatus = "positive" | "negative" | "neutral" | null;

interface EducationEntry {
    dateStart: string;
    dateEnd: string;
    educationType: string;
    university: string;
    speciality: string;
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
}

export const candidatesController = new Elysia({
    name: "@api/candidates",
})
    .use(ctx)
    .get("/candidates", async ({ query: { limit, offset, sort, filters, fields }, user, set, drizzle}) => {
        try {
            let selectFields: SelectedFields = {
                id: candidates.id,
                vacancyId: candidates.vacancyId,
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
            };

            if (fields) {
                selectFields = parseSelectFields(fields, candidates, {
                    vacancy: vacancy,
                });
            }

            let whereClause: (SQLWrapper | undefined)[] = [];
            if (filters) {
                whereClause = parseFilterFields(filters, candidates, {
                    vacancy: vacancy,
                });
            }

            const candidatesCount = await drizzle
                .select({ count: sql<number>`count(*)` })
                .from(candidates)
                .leftJoin(vacancy, eq(vacancy.id, candidates.vacancyId))
                .where(and(...whereClause))
                .execute();

            const candidatesList = await drizzle
                .select(selectFields)
                .from(candidates)
                .leftJoin(vacancy, eq(vacancy.id, candidates.vacancyId))
                .where(and(...whereClause))
                .limit(limit ? Number(limit) : 50)
                .offset(offset ? Number(offset) : 0)
                .execute();

            return {
                total: candidatesCount[0].count,
                data: candidatesList,
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
                // Create candidate
                const candidateData: CandidateInsert = {
                    vacancyId: candidateBody.vacancyId,
                    fullName: candidateBody.fullName,
                    birthDate: candidateBody.birthDate ? new Date(candidateBody.birthDate).toISOString() : null,
                    phoneNumber: candidateBody.phoneNumber,
                    email: candidateBody.email || null,
                    citizenship: candidateBody.citizenship || null,
                    residence: candidateBody.residence || null,
                    passportNumber: candidateBody.passportNumber || null,
                    passportSeries: candidateBody.passportSeries || null,
                    passportIdDate: candidateBody.passportIdDate ? new Date(candidateBody.passportIdDate).toISOString() : null,
                    passportIdPlace: candidateBody.passportIdPlace || null,
                    source: candidateBody.source || null,
                    familyStatus: candidateBody.familyStatus || null,
                    children: candidateBody.children || null,
                    language: candidateBody.language || null,
                    desiredSalary: candidateBody.desiredSalary ? Number(candidateBody.desiredSalary) : null,
                    desiredSchedule: candidateBody.desiredSchedule || null,
                    purpose: candidateBody.purpose || null,
                    strengthsShortage: candidateBody.strengthsShortage || null,
                    relatives: candidateBody.relatives || null,
                    desiredPosition: candidateBody.desiredPosition || null,
                    resultStatus: candidateBody.resultStatus || 'neutral'
                };

                const [newCandidate] = await tx
                    .insert(candidates)
                    .values(candidateData)
                    .returning()
                    .execute();

                if (!newCandidate?.id) {
                    throw new Error('Failed to create candidate record');
                }

                console.log('Created candidate:', newCandidate);

                // Handle education data
                if (candidateBody.educations && Array.isArray(candidateBody.educations) && candidateBody.educations.length > 0) {
                    console.log('Processing education records:', candidateBody.educations);

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

                        const educationResult = await tx
                            .insert(education)
                            .values(educationRecords)
                            .returning()
                            .execute();

                        console.log('Created education records:', educationResult);
                        
                        // Return candidate with education data
                        return {
                            ...newCandidate,
                            education: educationResult
                        };
                    } catch (educationError) {
                        console.error('Error creating education records:', educationError);
                        // Continue without education if there's an error
                        return newCandidate;
                    }
                } else {
                    console.log('No education data to process');
                    return newCandidate;
                }
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
            })))
        })
    })

    .put("/candidates/:id", async ({ params: { id }, body, user, set, drizzle, cacheController }) => {
        try {
            const updateData = {
                ...body,
                desiredSalary: body.desiredSalary ? Number(body.desiredSalary) : undefined,
                resultStatus: body.resultStatus as ResultStatus | undefined,
                updatedAt: new Date(),
            };

            const candidate = await drizzle
                .update(candidates)
                .set(updateData)
                .where(eq(candidates.id, id))
                .returning()
                .execute();

            if (!candidate.length) {
                set.status = 404;
                return {
                    error: "Candidate not found"
                };
            }

            await cacheController.cachePermissions();
            return {
                data: candidate[0],
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
            resultStatus: t.Optional(t.Enum({ positive: "positive", negative: "negative", neutral: "neutral" }))
        })
    })

    .delete("/candidates/:id", async ({ params: { id }, user, set, drizzle, cacheController }) => {
        try {
            const candidate = await drizzle
                .delete(candidates)
                .where(eq(candidates.id, id))
                .returning()
                .execute();

            if (!candidate.length) {
                set.status = 404;
                return {
                    error: "Candidate not found"
                };
            }

            await cacheController.cachePermissions();
            return {
                data: candidate[0],
            };
        } catch (error) {
            const err = error as ErrorResponse;
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