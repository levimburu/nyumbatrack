-- Show "Property Manager" instead of "Agent" in notification text
create or replace function public.notify_agent_assigned()
returns trigger language plpgsql security definer as $function$
declare
  v_agent_name text;
  v_property_name text;
  v_landlord_id uuid;
begin
  select full_name into v_agent_name from profiles where id = NEW.agent_id;
  select name, user_id into v_property_name, v_landlord_id from properties where id = NEW.property_id;

  if v_landlord_id is not null then
    perform create_notification(
      v_landlord_id,
      'Property Manager Assigned',
      v_agent_name || ' has been assigned to ' || v_property_name,
      'info'
    );
  end if;

  perform create_notification(
    NEW.agent_id,
    'Property Assigned',
    'You have been assigned to manage ' || v_property_name,
    'info'
  );
  return NEW;
end;
$function$;

update public.notifications set title = 'Property Manager Assigned' where title = 'Agent Assigned';
