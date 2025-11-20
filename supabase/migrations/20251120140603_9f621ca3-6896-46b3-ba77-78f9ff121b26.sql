-- Drop the existing SELECT policy that doesn't properly prevent anonymous access
DROP POLICY IF EXISTS "Users can view their own API keys" ON public.user_api_keys;

-- Create a new SELECT policy that explicitly prevents anonymous access
CREATE POLICY "Authenticated users can view only their own API keys" 
ON public.user_api_keys 
FOR SELECT 
USING (auth.uid() IS NOT NULL AND auth.uid() = user_id);
