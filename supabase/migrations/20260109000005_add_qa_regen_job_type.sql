-- Add qa_regen job type to the job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'qa_regen';

COMMENT ON TYPE job_type IS 'Job types: transcription, prompts, images, thumbnails, test_images, single_prompt, single_image, single_animation, upscale, qa, qa_regen';
